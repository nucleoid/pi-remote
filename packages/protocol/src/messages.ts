import { Type, type Static } from "@sinclair/typebox";
import { NonEmptySafeIntegerSchema, SafeIntegerSchema, UuidSchema } from "./ids.js";

const V3 = Type.Literal(3);
const isoTimestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$", maxLength: 40 });
const capability = Type.String({ minLength: 1, maxLength: 128 });
export const HelloSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("hello"), role: Type.Union([Type.Literal("bridge"), Type.Literal("client")]), supportedVersions: Type.Array(NonEmptySafeIntegerSchema, { minItems: 1, maxItems: 16 }), capabilities: Type.Array(capability, { maxItems: 64 }) });
export type Hello = Static<typeof HelloSchema>;
export const WelcomeSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("welcome"), selectedVersion: NonEmptySafeIntegerSchema, capabilities: Type.Array(capability, { maxItems: 64 }) });
export type Welcome = Static<typeof WelcomeSchema>;
export const ProtocolErrorMessageSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("protocol_error"), code: Type.String({ maxLength: 64 }), path: Type.Optional(Type.String({ maxLength: 256 })), message: Type.String({ maxLength: 2048 }) });

export const ProcessRegisterSchema = Type.Object({
  protocolVersion: V3, type: Type.Literal("process.register"), hostId: UuidSchema, processId: UuidSchema,
  processInstanceId: UuidSchema, sessionId: UuidSchema, parentProcessId: Type.Optional(UuidSchema), runId: Type.Optional(UuidSchema),
  metadata: Type.Record(Type.String({ maxLength: 64 }), Type.String({ maxLength: 1024 }), { maxProperties: 32 }),
  capabilities: Type.Array(capability, { maxItems: 64 }), heartbeatIntervalMs: Type.Integer({ minimum: 1000, maximum: 300000 }),
  nextProcessSequence: NonEmptySafeIntegerSchema,
});
export const ProcessRegisteredSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("process.registered"), processId: UuidSchema, processInstanceId: UuidSchema, resumeFromProcessSequence: NonEmptySafeIntegerSchema, headCursor: SafeIntegerSchema });
export const EventsSubscribeSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("events.subscribe"), afterCursor: SafeIntegerSchema, processIds: Type.Optional(Type.Array(UuidSchema, { maxItems: 256 })) });
export const HeartbeatSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("heartbeat"), processId: UuidSchema, processInstanceId: UuidSchema, sentAt: isoTimestamp });
