import { basename } from 'node:path';

export const PUBLIC_PI_HOOKS = [
  'session_info_changed', 'session_before_compact', 'session_compact',
  'agent_start', 'agent_end', 'agent_settled', 'turn_start', 'turn_end',
  'message_start', 'message_update', 'message_end',
  'tool_execution_start', 'tool_execution_update', 'tool_execution_end',
  'tool_call', 'tool_result', 'model_select', 'thinking_level_select', 'context', 'input',
] as const;

function bounded(value: unknown, max = 128): string {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function safeContent(message: any): unknown {
  if (typeof message?.content === 'string') return message.content.slice(0, 262_144);
  if (!Array.isArray(message?.content)) return undefined;
  return message.content.flatMap((item: any) => {
    if (item?.type === 'text' && typeof item.text === 'string') return [{ type: 'text', text: item.text.slice(0, 262_144) }];
    if (item?.type === 'toolCall') return [{ type: 'toolCall', id: bounded(item.id), name: bounded(item.name), arguments: {} }];
    if (item?.type === 'image') return [{ type: 'image', omitted: true }];
    return [];
  });
}

export function publicProcessState(ctx: any, options: { pathPolicy?: 'none' | 'basename' | 'full' } = {}) {
  const policy = options.pathPolicy ?? 'basename';
  const cwd = policy === 'full' ? ctx?.cwd : policy === 'basename' && ctx?.cwd ? basename(ctx.cwd) : undefined;
  const sessionPath = ctx?.sessionManager?.getSessionFile?.();
  return {
    ...(cwd ? { cwd: bounded(cwd, 1024) } : {}),
    isIdle: ctx?.isIdle?.() ?? true,
    hasPendingMessages: ctx?.hasPendingMessages?.() ?? false,
    ...(sessionPath && policy !== 'none' ? { sessionFile: policy === 'full' ? bounded(sessionPath, 1024) : basename(sessionPath) } : {}),
    ...(ctx?.model ? { model: { provider: bounded(ctx.model.provider), id: bounded(ctx.model.id, 256) } } : {}),
  };
}

export function mapPiEvent(name: string, event: any, ctx: any, scope: { runId: string; sessionId: string }): Record<string, any> | undefined {
  switch (name) {
    case 'agent_start': return { type: 'agent_start', runId: scope.runId };
    case 'agent_end': return { type: 'agent_end', runId: scope.runId, source: 'extension' };
    case 'agent_settled': return ctx?.isIdle?.() ? { type: 'agent_settled', runId: scope.runId, state: { isIdle: true } } : undefined;
    case 'turn_start': return { type: 'turn_start', runId: scope.runId };
    case 'turn_end': return { type: 'turn_end', runId: scope.runId };
    case 'message_start':
    case 'message_end': {
      const role = bounded(event?.message?.role, 32);
      if (!role) return undefined;
      return { type: 'message', role, content: safeContent(event.message) };
    }
    case 'message_update': {
      const update = event?.assistantMessageEvent;
      if (update?.type === 'text_delta') return { type: 'assistant_delta', text: bounded(update.delta, 262_144) };
      if (update?.type === 'thinking_delta') return { type: 'thinking_delta', text: bounded(update.delta, 262_144) };
      if (update?.type === 'toolcall_end') return { type: 'tool_call', toolCallId: bounded(update.toolCall?.id), toolName: bounded(update.toolCall?.name), args: {} };
      return undefined;
    }
    case 'tool_execution_start': return { type: 'tool_start', toolCallId: bounded(event?.toolCallId), toolName: bounded(event?.toolName), args: {} };
    case 'tool_execution_update': return { type: 'tool_update', toolCallId: bounded(event?.toolCallId), partialResult: { redacted: true } };
    case 'tool_execution_end': return { type: 'tool_end', toolCallId: bounded(event?.toolCallId), result: { redacted: true }, isError: !!event?.isError };
    case 'model_select': return { type: 'model', provider: bounded(event?.model?.provider), id: bounded(event?.model?.id, 256) };
    case 'thinking_level_select': return { type: 'thinking', level: bounded(event?.level, 64) };
    case 'session_before_compact': return { type: 'compaction', phase: 'before' };
    case 'session_compact': return { type: 'compaction', phase: 'complete' };
    case 'session_info_changed': return { type: 'process_state', state: publicProcessState(ctx) };
    default: return undefined;
  }
}
