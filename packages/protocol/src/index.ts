export * from "./ids.js";
export * from "./capabilities.js";
export * from "./messages.js";
export * from "./events.js";
export * from "./commands.js";
export * from "./validation.js";
export * from "./jsonl.js";
export * from "./redaction.js";
export * from "./v2-adapter.js";

import { canonicalJson, ProtocolError, validateSchema } from "./validation.js";
import { intersectKnownCapabilities } from "./capabilities.js";
import { EventPublishSchema, parseEventBody } from "./events.js";
import { CommandRequestSchema, parseCommandBody } from "./commands.js";
import { EventsSubscribeSchema, HeartbeatSchema, HelloSchema, ProcessRegisterSchema } from "./messages.js";

export function negotiateHello(input: unknown, supportedVersions: readonly number[] = [3], supportedCapabilities: readonly string[] = []): { protocolVersion: 3; type: "welcome"; selectedVersion: number; capabilities: string[] } {
  const hello = validateSchema<any>(HelloSchema, input, "invalid_hello");
  const supported = new Set(supportedVersions);
  const selectedVersion = [...new Set<number>(hello.supportedVersions)].filter(value => supported.has(value)).sort((a, b) => b - a)[0];
  if (selectedVersion === undefined) throw new ProtocolError("no_common_version", undefined, "No common protocol version", 1002);
  return { protocolVersion: 3, type: "welcome", selectedVersion, capabilities: intersectKnownCapabilities(hello.capabilities, supportedCapabilities) };
}

export class ProtocolSession {
  #welcomed = false;
  role?: "bridge" | "client";
  readonly supportedVersions: readonly number[];
  readonly capabilities: readonly string[];
  constructor(supportedVersions: readonly number[] = [3], capabilities: readonly string[] = []) {
    this.supportedVersions = supportedVersions;
    this.capabilities = capabilities;
  }
  receive(value: any): Record<string, unknown> | undefined {
    if (!this.#welcomed) {
      if (value?.type !== "hello") throw new ProtocolError("negotiation_required", "type", "hello must be the first message");
      const welcome = negotiateHello(value, this.supportedVersions, this.capabilities);
      this.role = value.role;
      this.#welcomed = true;
      return welcome;
    }
    if (value?.type === "hello") throw new ProtocolError("already_negotiated");
    if (value?.type === "process.register") {
      if (this.role !== "bridge") throw new ProtocolError("role_violation");
      validateSchema(ProcessRegisterSchema, value, "invalid_process_register");
    } else if (value?.type === "heartbeat") {
      validateSchema(HeartbeatSchema, value, "invalid_heartbeat");
    } else if (value?.type === "events.subscribe") {
      validateSchema(EventsSubscribeSchema, value, "invalid_events_subscribe");
    }
    return undefined;
  }
}

type ProducerRecord = { canonical: string; cursor: number; value: any };
export class ProducerLedger {
  #head = 0;
  #byTuple = new Map<string, ProducerRecord>();
  #byEventId = new Map<string, ProducerRecord>();
  #next = new Map<string, number>();
  commit(value: any): { cursor: number; duplicate: boolean; expectedNextSequence: number } {
    validateSchema(EventPublishSchema, value, "invalid_event_publish");
    parseEventBody(value.event);
    const producer = `${value.processId}\0${value.processInstanceId}`;
    const tuple = `${producer}\0${value.processSequence}`;
    const canonical = canonicalJson(value);
    const existing = this.#byTuple.get(tuple) ?? this.#byEventId.get(value.eventId);
    if (existing) {
      if (existing.canonical !== canonical) throw new ProtocolError("event_conflict", undefined, "Event identity was reused with different content");
      return { cursor: existing.cursor, duplicate: true, expectedNextSequence: (this.#next.get(producer) ?? 1) };
    }
    const expected = this.#next.get(producer) ?? 1;
    if (value.processSequence !== expected) throw new ProtocolError("process_sequence_gap", "processSequence", "Producer sequence is not contiguous", 1002, { expectedSequence: expected });
    if (this.#head >= Number.MAX_SAFE_INTEGER) throw new ProtocolError("cursor_exhausted");
    const record = { canonical, cursor: ++this.#head, value: structuredClone(value) };
    this.#byTuple.set(tuple, record);
    this.#byEventId.set(value.eventId, record);
    this.#next.set(producer, expected + 1);
    return { cursor: record.cursor, duplicate: false, expectedNextSequence: expected + 1 };
  }
  resumeFrom(processId: string, processInstanceId: string): number { return this.#next.get(`${processId}\0${processInstanceId}`) ?? 1; }
  get headCursor(): number { return this.#head; }
}

type CommandState = { canonical: string; ack: any; result?: any };
export class CommandLedger {
  #commands = new Map<string, CommandState>();
  accept(principal: string, request: any): { status: "accepted"; duplicate: boolean; result?: any } {
    validateSchema(CommandRequestSchema, request, "invalid_command_request");
    const command = parseCommandBody(request.command);
    if (command.type === "unknown") throw new ProtocolError("unsupported_command");
    const canonical = canonicalJson({ principal, request });
    const existing = this.#commands.get(request.commandId);
    if (existing) {
      if (existing.canonical !== canonical) throw new ProtocolError("command_conflict");
      return { status: "accepted", duplicate: true, ...(existing.result ? { result: existing.result } : {}) };
    }
    this.#commands.set(request.commandId, { canonical, ack: { status: "accepted" } });
    return { status: "accepted", duplicate: false };
  }
  complete(commandId: string, result: any): any {
    const state = this.#commands.get(commandId);
    if (!state) throw new ProtocolError("result_before_ack");
    if (state.result) {
      if (canonicalJson(state.result) !== canonicalJson(result)) throw new ProtocolError("command_result_conflict");
      return state.result;
    }
    if (!["completed", "failed", "cancelled", "timed_out"].includes(result?.status)) throw new ProtocolError("invalid_command_result");
    state.result = structuredClone(result);
    return state.result;
  }
}

export class CursorStore<T extends Record<string, any> = Record<string, any>> {
  #head = 0;
  #minimumCursor = 1;
  #events: Array<T & { cursor: number }> = [];
  append(value: T): T & { cursor: number } {
    if (this.#head >= Number.MAX_SAFE_INTEGER) throw new ProtocolError("cursor_exhausted");
    const committed = { ...structuredClone(value), cursor: ++this.#head } as T & { cursor: number };
    this.#events.push(committed);
    return committed;
  }
  replay(afterCursor: number, filter?: (event: T & { cursor: number }) => boolean): Array<T & { cursor: number }> {
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new ProtocolError("invalid_cursor");
    if (afterCursor > this.#head) throw new ProtocolError("cursor_ahead", undefined, "Cursor is above daemon head", 1002, { headCursor: this.#head });
    if (afterCursor < this.#minimumCursor - 1) throw new ProtocolError("cursor_expired", undefined, "Cursor is no longer retained", 1002, { minimumCursor: this.#minimumCursor });
    return this.#events.filter(event => event.cursor > afterCursor && (!filter || filter(event))).map(event => structuredClone(event));
  }
  snapshot<S>(projection: S): S & { throughCursor: number } { return { ...structuredClone(projection), throughCursor: this.#head }; }
  expireThrough(cursor: number): void {
    if (!Number.isSafeInteger(cursor) || cursor < 0 || cursor > this.#head) throw new ProtocolError("invalid_cursor");
    this.#events = this.#events.filter(event => event.cursor > cursor);
    this.#minimumCursor = Math.max(this.#minimumCursor, cursor + 1);
  }
  get headCursor(): number { return this.#head; }
  get minimumCursor(): number { return this.#minimumCursor; }
}
