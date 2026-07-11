import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

export type PublishedEvent = {
  protocolVersion: 3;
  type: 'event.publish';
  eventId: string;
  processId: string;
  processInstanceId: string;
  processSequence: number;
  occurredAt: string;
  event: Record<string, any>;
};

type Pending = { event: Record<string, any>; coalesceKey?: string; mandatory?: boolean; snapshot?: boolean };
type Options = { path: string; processId: string; processInstanceId: string; maxItems?: number; maxBytes?: number };

export class DurableOutbox {
  readonly path: string;
  readonly processId: string;
  readonly processInstanceId: string;
  readonly maxItems: number;
  readonly maxBytes: number;
  #pending: Pending[] = [];
  #assigned: PublishedEvent[] = [];
  #nextSequence = 1;
  #degraded = false;
  #recoveryThroughSequence?: number;

  constructor(options: Options) {
    this.path = options.path;
    this.processId = options.processId;
    this.processInstanceId = options.processInstanceId;
    this.maxItems = options.maxItems ?? 2048;
    this.maxBytes = options.maxBytes ?? 8 * 1024 * 1024;
    try {
      const value = JSON.parse(readFileSync(this.path, 'utf8'));
      if (value.processId === this.processId && value.processInstanceId === this.processInstanceId && Array.isArray(value.assigned)) {
        this.#assigned = value.assigned;
        this.#nextSequence = Number.isSafeInteger(value.nextSequence) ? value.nextSequence : (this.#assigned.at(-1)?.processSequence ?? 0) + 1;
        this.#degraded = value.degraded === true;
        this.#recoveryThroughSequence = Number.isSafeInteger(value.recoveryThroughSequence) ? value.recoveryThroughSequence : undefined;
      }
    } catch { /* missing/corrupt spools recover empty and report through a later gap */ }
  }

  get bytes(): number { return Buffer.byteLength(JSON.stringify({ assigned: this.#assigned, pending: this.#pending }), 'utf8'); }

  observe(event: Record<string, any>, options: Omit<Pending, 'event'> = {}): void {
    if (this.#degraded && !options.mandatory && !options.snapshot) return;
    if (options.coalesceKey) {
      const previous = this.#pending.find(item => item.coalesceKey === options.coalesceKey);
      if (previous && typeof previous.event.text === 'string' && typeof event.text === 'string') {
        previous.event = { ...previous.event, text: previous.event.text + event.text };
        if (!this.#fits()) this.#degrade();
        return;
      }
    }
    if (options.snapshot) this.#pending = this.#pending.filter(item => !item.snapshot);
    this.#pending.push({ event: structuredClone(event), ...options });
    if (!this.#fits()) this.#degrade(options.snapshot ? event : undefined);
  }

  #fits(): boolean {
    return this.#assigned.length + this.#pending.length <= this.maxItems && this.bytes <= this.maxBytes;
  }

  #degrade(latestSnapshot?: Record<string, any>): void {
    this.#degraded = true;
    const snapshot = latestSnapshot ?? this.#pending.findLast(item => item.snapshot)?.event;
    const expectedSequence = this.#nextSequence;
    this.#pending = [{ event: { type: 'gap', expectedSequence }, mandatory: true }];
    if (snapshot) this.#pending.push({ event: structuredClone(snapshot), mandatory: true, snapshot: true });
    while (!this.#fits() && this.#pending.length > 1) this.#pending.splice(1, 1);
  }

  assign(): PublishedEvent[] {
    const assigningRecovery = this.#degraded && this.#recoveryThroughSequence === undefined && this.#pending.some(item => item.event.type === 'gap');
    for (const item of this.#pending) {
      this.#assigned.push(Object.freeze({
        protocolVersion: 3,
        type: 'event.publish',
        eventId: randomUUID(),
        processId: this.processId,
        processInstanceId: this.processInstanceId,
        processSequence: this.#nextSequence++,
        occurredAt: new Date().toISOString(),
        event: structuredClone(item.event),
      }));
    }
    if (assigningRecovery) this.#recoveryThroughSequence = this.#assigned.at(-1)?.processSequence;
    this.#pending = [];
    this.#persist();
    return this.#assigned.map(item => structuredClone(item));
  }

  resumeFrom(nextSequence: number): PublishedEvent[] {
    if (!Number.isSafeInteger(nextSequence) || nextSequence < 1 || nextSequence > this.#nextSequence) throw new Error('resume_conflict');
    this.#assigned = this.#assigned.filter(item => item.processSequence >= nextSequence);
    this.#persist();
    return this.#assigned.map(item => structuredClone(item));
  }

  acknowledge(processSequence: number): void {
    this.#assigned = this.#assigned.filter(item => item.processSequence > processSequence);
    if (this.#degraded && this.#recoveryThroughSequence !== undefined && processSequence >= this.#recoveryThroughSequence) {
      this.#degraded = false;
      this.#recoveryThroughSequence = undefined;
    }
    this.#persist();
  }

  #persist(): void {
    mkdirSync(dirname(this.path), { recursive: true, mode: 0o700 });
    const temporary = `${this.path}.${process.pid}.tmp`;
    const body = JSON.stringify({ processId: this.processId, processInstanceId: this.processInstanceId, nextSequence: this.#nextSequence, assigned: this.#assigned, degraded: this.#degraded, ...(this.#recoveryThroughSequence !== undefined ? { recoveryThroughSequence: this.#recoveryThroughSequence } : {}) });
    writeFileSync(temporary, body, { encoding: 'utf8', mode: 0o600 });
    renameSync(temporary, this.path);
    try { chmodSync(this.path, 0o600); } catch { /* best effort */ }
  }
}
