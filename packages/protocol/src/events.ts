import { Type, type Static } from "@sinclair/typebox";
import { NonEmptySafeIntegerSchema, UuidSchema } from "./ids.js";
import { ProtocolError, validateSchema } from "./validation.js";

const state = Type.Object({ isIdle: Type.Boolean() });
const run = { runId: UuidSchema };
const eventSchemas = {
  host_state: Type.Object({ type: Type.Literal("host_state"), state: Type.Record(Type.String(), Type.Unknown()) }),
  process_state: Type.Object({ type: Type.Literal("process_state"), state: Type.Record(Type.String(), Type.Unknown()) }),
  session_start: Type.Object({ type: Type.Literal("session_start"), sessionId: UuidSchema }),
  session_shutdown: Type.Object({ type: Type.Literal("session_shutdown"), sessionId: UuidSchema }),
  agent_start: Type.Object({ type: Type.Literal("agent_start"), ...run }),
  agent_end: Type.Object({ type: Type.Literal("agent_end"), ...run, willRetry: Type.Optional(Type.Boolean()), source: Type.Optional(Type.Union([Type.Literal("extension"), Type.Literal("rpc")])) }),
  agent_settled: Type.Object({ type: Type.Literal("agent_settled"), ...run, state }),
  turn_start: Type.Object({ type: Type.Literal("turn_start"), ...run }),
  turn_end: Type.Object({ type: Type.Literal("turn_end"), ...run }),
  message: Type.Object({ type: Type.Literal("message"), role: Type.String({ maxLength: 32 }), content: Type.Unknown() }),
  assistant_delta: Type.Object({ type: Type.Literal("assistant_delta"), text: Type.String({ maxLength: 262144 }) }),
  thinking_delta: Type.Object({ type: Type.Literal("thinking_delta"), text: Type.String({ maxLength: 262144 }) }),
  tool_call: Type.Object({ type: Type.Literal("tool_call"), toolCallId: Type.String({ maxLength: 128 }), toolName: Type.String({ maxLength: 128 }), args: Type.Record(Type.String(), Type.Unknown()) }),
  tool_start: Type.Object({ type: Type.Literal("tool_start"), toolCallId: Type.String({ maxLength: 128 }), toolName: Type.String({ maxLength: 128 }), args: Type.Record(Type.String(), Type.Unknown()) }),
  tool_update: Type.Object({ type: Type.Literal("tool_update"), toolCallId: Type.String({ maxLength: 128 }), partialResult: Type.Unknown() }),
  tool_end: Type.Object({ type: Type.Literal("tool_end"), toolCallId: Type.String({ maxLength: 128 }), result: Type.Unknown(), isError: Type.Boolean() }),
  queue_snapshot: Type.Object({ type: Type.Literal("queue_snapshot"), steering: Type.Array(Type.Unknown(), { maxItems: 256 }), followUp: Type.Array(Type.Unknown(), { maxItems: 256 }) }),
  compaction: Type.Object({ type: Type.Literal("compaction"), phase: Type.String({ maxLength: 32 }) }),
  retry: Type.Object({ type: Type.Literal("retry"), phase: Type.String({ maxLength: 32 }) }),
  model: Type.Object({ type: Type.Literal("model"), provider: Type.String({ maxLength: 128 }), id: Type.String({ maxLength: 256 }) }),
  thinking: Type.Object({ type: Type.Literal("thinking"), level: Type.String({ maxLength: 64 }) }),
  usage: Type.Object({ type: Type.Literal("usage"), inputTokens: NonEmptySafeIntegerSchema, outputTokens: NonEmptySafeIntegerSchema }),
  extension_ui: Type.Object({ type: Type.Literal("extension_ui"), action: Type.String({ maxLength: 64 }) }),
  client_count: Type.Object({ type: Type.Literal("client_count"), count: Type.Integer({ minimum: 0, maximum: 10000 }) }),
  gap: Type.Object({ type: Type.Literal("gap"), expectedSequence: NonEmptySafeIntegerSchema }),
  resync: Type.Object({ type: Type.Literal("resync"), reason: Type.String({ maxLength: 256 }) }),
  status: Type.Object({ type: Type.Literal("status"), code: Type.String({ maxLength: 64 }), message: Type.Optional(Type.String({ maxLength: 2048 })) }),
  error: Type.Object({ type: Type.Literal("error"), code: Type.String({ maxLength: 64 }), message: Type.String({ maxLength: 2048 }) }),
} as const;

export const EventBodySchema = Type.Union(Object.values(eventSchemas));
export type EventBody = Static<typeof EventBodySchema>;
export type UnknownEvent = { type: "unknown"; originalType: string; value: Record<string, unknown> };
export const EventPublishSchema = Type.Object({ protocolVersion: Type.Literal(3), type: Type.Literal("event.publish"), eventId: UuidSchema, processId: UuidSchema, processInstanceId: UuidSchema, processSequence: NonEmptySafeIntegerSchema, occurredAt: Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$", maxLength: 40 }), event: Type.Record(Type.String(), Type.Unknown()) });

export function parseEventBody(value: unknown): EventBody | UnknownEvent {
  if (!value || typeof value !== "object" || Array.isArray(value) || typeof (value as any).type !== "string") throw new ProtocolError("invalid_event", "event.type", "Event must be an object with a type");
  const type = (value as any).type as string;
  const schema = (eventSchemas as Record<string, any>)[type];
  if (!schema) return { type: "unknown", originalType: type, value: value as Record<string, unknown> };
  return validateSchema(schema, value, "invalid_event") as EventBody;
}
