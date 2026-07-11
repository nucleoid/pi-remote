import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { parseCommandBody } from '@nucleoid/pi-remote-protocol';

const THINKING_LEVELS = new Set(['off', 'minimal', 'low', 'medium', 'high', 'xhigh']);
const UNSUPPORTED = new Set(['queue_mode', 'retry', 'force_terminate']);

type Frame = Record<string, any>;
type Dependencies = {
  pi: ExtensionAPI;
  ctx: ExtensionContext;
  processId: string;
  sessionId: string;
  generation: number;
  isCurrent(): boolean;
  send(frame: Frame): void;
  onAbort?: () => void;
  buildContent?: (text: string, images?: any[], files?: any[]) => any;
};

type Cached = { fingerprint: string; frames: Frame[] };

export function createControlHandler(deps: Dependencies) {
  const cache = new Map<string, Cached>();

  function emit(frame: Frame, capture?: Frame[]) {
    const value = { protocolVersion: 3, ...frame };
    deps.send(value);
    capture?.push(value);
  }

  function reject(commandId: string, code: string) {
    emit({ type: 'command.ack', commandId, status: 'rejected', code });
  }

  return async function handle(request: any): Promise<void> {
    const commandId = typeof request?.commandId === 'string' ? request.commandId : '00000000-0000-4000-8000-000000000000';
    const fingerprint = JSON.stringify(request);
    const known = cache.get(commandId);
    if (known) {
      if (known.fingerprint !== fingerprint) { reject(commandId, 'duplicate_conflict'); return; }
      for (const frame of known.frames) deps.send(structuredClone(frame));
      return;
    }
    if (request?.targetProcessId !== deps.processId) { reject(commandId, 'wrong_process'); return; }
    if (request?.sessionId !== undefined && request.sessionId !== deps.sessionId) { reject(commandId, 'wrong_session'); return; }
    if (!deps.isCurrent()) { reject(commandId, 'stale_generation'); return; }
    if (request?.deadline && (!Number.isFinite(Date.parse(request.deadline)) || Date.parse(request.deadline) <= Date.now())) { reject(commandId, 'deadline_expired'); return; }

    let command: any;
    try { command = parseCommandBody(request?.command); } catch { reject(commandId, 'invalid_payload'); return; }
    if (command.type === 'unknown' || UNSUPPORTED.has(command.type)) { reject(commandId, 'unsupported_capability'); return; }
    if (command.type === 'prompt') {
      const hasAttachments = (command.images?.length ?? 0) + (command.files?.length ?? 0) > 0;
      if (!command.text.trim() && !hasAttachments) { reject(commandId, 'blank_prompt'); return; }
      if (!deps.ctx.isIdle() && command.deliverAs !== 'steer' && command.deliverAs !== 'follow_up') { reject(commandId, 'busy_policy_required'); return; }
    }
    if (command.type === 'thinking' && !THINKING_LEVELS.has(command.level)) { reject(commandId, 'invalid_thinking'); return; }

    const frames: Frame[] = [];
    emit({ type: 'command.ack', commandId, status: 'accepted' }, frames);
    try {
      if (!deps.isCurrent()) throw new ControlError('stale_generation');
      let result: unknown;
      switch (command.type) {
        case 'prompt': {
          const content = deps.buildContent ? deps.buildContent(command.text, command.images, command.files) : command.text;
          const delivery = command.deliverAs === 'follow_up' ? 'followUp' : command.deliverAs === 'steer' ? 'steer' : undefined;
          if (delivery) deps.pi.sendUserMessage(content, { deliverAs: delivery });
          else deps.pi.sendUserMessage(content);
          break;
        }
        case 'steer':
          if (!command.text.trim()) throw new ControlError('blank_prompt');
          deps.pi.sendUserMessage(command.text, { deliverAs: 'steer' });
          break;
        case 'follow_up':
          if (!command.text.trim()) throw new ControlError('blank_prompt');
          deps.pi.sendUserMessage(command.text, { deliverAs: 'followUp' });
          break;
        case 'abort': deps.onAbort?.(); deps.ctx.abort(); result = { aborted: true, processTerminated: false }; break;
        case 'model': {
          const model = deps.ctx.modelRegistry.find(command.provider, command.id);
          if (!model) throw new ControlError('model_not_found');
          if (!await deps.pi.setModel(model)) throw new ControlError('model_key_unavailable');
          break;
        }
        case 'thinking': deps.pi.setThinkingLevel(command.level); break;
        case 'compact':
          await new Promise<void>((resolve, rejectPromise) => deps.ctx.compact({
            onComplete: () => deps.isCurrent() ? resolve() : rejectPromise(new ControlError('stale_generation')),
            onError: () => rejectPromise(new ControlError('compaction_failed')),
          }));
          break;
        case 'state': result = { isIdle: deps.ctx.isIdle(), hasPendingMessages: deps.ctx.hasPendingMessages() }; break;
        case 'history': result = { messages: deps.ctx.sessionManager.getBranch().flatMap((entry: any) => entry?.message ? [entry.message] : []).slice(-(command.limit ?? 50)) }; break;
        default: throw new ControlError('unsupported_capability');
      }
      emit({ type: 'command.result', commandId, status: 'completed', ...(result === undefined ? {} : { result }) }, frames);
    } catch (error) {
      const code = error instanceof ControlError ? error.code : 'command_failed';
      emit({ type: 'command.result', commandId, status: 'failed', error: { code, message: 'Remote command failed' } }, frames);
    }
    cache.set(commandId, { fingerprint, frames });
    if (cache.size > 1024) cache.delete(cache.keys().next().value!);
  };
}

class ControlError extends Error {
  readonly code: string;
  constructor(code: string) { super(code); this.code = code; }
}
