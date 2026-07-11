import { Value } from 'typebox/value';

type GateResult = { block: true; reason: string } | undefined;
type Policy = { leaseId: string; failMode: 'failOpen' | 'failClosed'; timeoutMs: number; includeArguments: boolean; persistent: boolean };
type Pending = { event: any; policy: Policy; timer: NodeJS.Timeout; resolve(value: GateResult): void; settled: boolean };
type GateDependencies = {
  targetProcessId: string;
  sessionId: string;
  getTool(name: string): { name: string; parameters: any } | undefined;
  send(frame: Record<string, unknown>): void;
  audit(record: Record<string, unknown>): void;
  isCurrent(): boolean;
};

const DENIED: GateResult = { block: true, reason: 'Remote tool policy denied execution' };
const UNAVAILABLE: GateResult = { block: true, reason: 'Remote tool policy unavailable' };
const CANCELLED: GateResult = { block: true, reason: 'Tool call cancelled' };

export class GateController {
  #deps: GateDependencies;
  #policy?: Policy;
  #pending = new Map<string, Pending>();
  #closed = false;
  constructor(dependencies: GateDependencies) { this.#deps = dependencies; }

  arm(policy: Policy): void {
    if (this.#closed) throw new Error('gate_closed');
    if (!policy.leaseId || policy.timeoutMs < 1 || policy.timeoutMs > 300_000) throw new Error('invalid_gate_policy');
    this.#policy = { ...policy };
  }

  gate(event: any): Promise<GateResult> | GateResult {
    const policy = this.#policy;
    if (!policy || this.#closed) return undefined;
    if (!this.#deps.isCurrent()) return CANCELLED;
    if (this.#pending.has(event.toolCallId)) return DENIED;
    const tool = this.#deps.getTool(event.toolName);
    if (!tool?.parameters) {
      if (!policy.persistent && policy.failMode === 'failOpen') this.#policy = undefined;
      return policy.failMode === 'failOpen' ? undefined : DENIED;
    }
    if (!policy.persistent) this.#policy = undefined;
    const frame: Record<string, unknown> = {
      protocolVersion: 3, type: 'tool_gate.request', toolCallId: event.toolCallId,
      toolName: event.toolName, leaseId: policy.leaseId, targetProcessId: this.#deps.targetProcessId, sessionId: this.#deps.sessionId, persistable: false,
      metadata: { argumentKeys: Object.keys(event.input ?? {}).sort() },
    };
    if (policy.includeArguments) frame.arguments = cloneJson(event.input);
    this.#deps.send(frame);
    return new Promise<GateResult>(resolve => {
      const timer = setTimeout(() => this.#settle(event.toolCallId, policy.failMode === 'failOpen' ? undefined : UNAVAILABLE, 'timeout'), policy.timeoutMs);
      this.#pending.set(event.toolCallId, { event, policy, timer, resolve, settled: false });
    });
  }

  decide(decision: any): 'accepted' | 'stale' {
    const pending = this.#pending.get(decision?.toolCallId);
    if (!pending || pending.settled || decision?.leaseId !== pending.policy.leaseId) return 'stale';
    if (!this.#deps.isCurrent()) { this.#settle(decision.toolCallId, CANCELLED, 'stale_generation'); return 'accepted'; }
    if (decision.decision === 'deny') { this.#settle(decision.toolCallId, DENIED, 'deny'); return 'accepted'; }
    if (decision.decision !== 'allow') { this.#settle(decision.toolCallId, DENIED, 'invalid_decision'); return 'accepted'; }
    if (decision.replacementArgs !== undefined) {
      try {
        const tool = this.#deps.getTool(pending.event.toolName);
        if (!tool?.parameters || containsRef(tool.parameters)) throw new Error('unsupported_schema');
        const candidate = cloneJson(decision.replacementArgs);
        if (!isPlainObject(candidate) || !Value.Check(tool.parameters, candidate)) throw new Error('invalid_replacement');
        if (!this.#deps.isCurrent()) throw new Error('stale_generation');
        const changedKeys = structuralDiffKeys(pending.event.input, candidate);
        replaceOwnProperties(pending.event.input, candidate);
        this.#settle(decision.toolCallId, undefined, 'edit', { changedKeys });
      } catch { this.#settle(decision.toolCallId, DENIED, 'edit_rejected'); }
      return 'accepted';
    }
    this.#settle(decision.toolCallId, undefined, 'allow');
    return 'accepted';
  }

  disconnectLease(leaseId: string): void {
    if (this.#policy?.leaseId === leaseId) this.#policy = undefined;
    for (const [id, pending] of this.#pending) if (pending.policy.leaseId === leaseId) this.#settle(id, pending.policy.failMode === 'failOpen' ? undefined : UNAVAILABLE, 'lease_disconnect');
  }

  daemonDisconnected(): void { for (const [id, pending] of this.#pending) this.#settle(id, pending.policy.failMode === 'failOpen' ? undefined : UNAVAILABLE, 'daemon_disconnect'); }
  abort(): void { for (const id of [...this.#pending.keys()]) this.#settle(id, CANCELLED, 'abort'); }
  shutdown(): void { this.#closed = true; this.#policy = undefined; this.abort(); }

  #settle(id: string, result: GateResult, outcome: string, extra: Record<string, unknown> = {}): void {
    const pending = this.#pending.get(id);
    if (!pending || pending.settled) return;
    pending.settled = true;
    clearTimeout(pending.timer);
    this.#pending.delete(id);
    this.#deps.audit({ toolCallId: id, toolName: pending.event.toolName, leaseId: pending.policy.leaseId, outcome, ...extra });
    pending.resolve(result);
  }
}

function containsRef(value: unknown): boolean {
  if (!value || typeof value !== 'object') return false;
  if (Object.prototype.hasOwnProperty.call(value, '$ref')) return true;
  return Object.values(value).some(containsRef);
}
function isPlainObject(value: unknown): value is Record<string, unknown> { return !!value && typeof value === 'object' && !Array.isArray(value) && Object.getPrototypeOf(value) === Object.prototype; }
function cloneJson(value: any, seen = new Set<any>()): any {
  if (value === null || typeof value === 'string' || typeof value === 'boolean') return value;
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (!value || typeof value !== 'object' || seen.has(value)) throw new Error('non_json');
  seen.add(value);
  if (Array.isArray(value)) { const result = value.map(item => cloneJson(item, seen)); seen.delete(value); return result; }
  if (Object.getPrototypeOf(value) !== Object.prototype) throw new Error('non_plain_object');
  const result: Record<string, unknown> = {};
  for (const key of Reflect.ownKeys(value)) {
    if (typeof key !== 'string' || key === '__proto__' || key === 'prototype' || key === 'constructor') throw new Error('dangerous_key');
    const descriptor = Object.getOwnPropertyDescriptor(value, key)!;
    if (!('value' in descriptor)) throw new Error('accessor');
    Object.defineProperty(result, key, { value: cloneJson(descriptor.value, seen), enumerable: true, writable: true, configurable: true });
  }
  seen.delete(value); return result;
}
function replaceOwnProperties(target: Record<string, unknown>, source: Record<string, unknown>): void {
  if (!isPlainObject(target)) throw new Error('target_not_plain');
  for (const key of Object.keys(target)) delete target[key];
  for (const [key, value] of Object.entries(source)) Object.defineProperty(target, key, { value, enumerable: true, writable: true, configurable: true });
}
function structuralDiffKeys(before: Record<string, unknown>, after: Record<string, unknown>): string[] { return [...new Set([...Object.keys(before), ...Object.keys(after)])].sort(); }

export class PauseController {
  state: 'idle' | 'armed' | 'paused' = 'idle';
  #generation?: number;
  #leaseId?: string;
  #disconnectMode: 'resume' | 'holdUntilDeadline' = 'resume';
  #deadline = 0;
  #waiters = new Set<() => void>();
  arm(scope: { generation: number; leaseId?: string; deadline: number; disconnectMode?: 'resume' | 'holdUntilDeadline' }): void {
    if (!Number.isFinite(scope.deadline) || scope.deadline <= Date.now()) throw new Error('invalid_pause_scope');
    this.release(); this.#generation = scope.generation; this.#leaseId = scope.leaseId; this.#deadline = scope.deadline; this.#disconnectMode = scope.disconnectMode ?? 'resume'; this.state = 'armed';
  }
  boundary(_boundary: 'context' | 'tool_call', generation: number): Promise<void> {
    if (this.state === 'idle' || generation !== this.#generation || Date.now() >= this.#deadline) { if (Date.now() >= this.#deadline) this.release(); return Promise.resolve(); }
    this.state = 'paused';
    return new Promise(resolve => {
      const done = () => { clearTimeout(timer); this.#waiters.delete(done); resolve(); };
      const timer = setTimeout(() => { this.release(); }, Math.max(1, this.#deadline - Date.now()));
      this.#waiters.add(done);
    });
  }
  resume(generation: number, leaseId?: string): void { if (generation === this.#generation && (!this.#leaseId || leaseId === this.#leaseId)) this.release(); }
  disconnectLease(leaseId: string): void { if (leaseId === this.#leaseId && this.#disconnectMode === 'resume') this.release(); }
  daemonDisconnected(): void { if (this.#disconnectMode === 'resume') this.release(); }
  shutdown(): void { this.release(); }
  private release(): void { for (const waiter of [...this.#waiters]) waiter(); this.#waiters.clear(); this.#generation = undefined; this.#leaseId = undefined; this.#deadline = 0; this.state = 'idle'; }
}
