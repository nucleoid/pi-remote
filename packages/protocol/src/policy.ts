import { Type, type Static } from "@sinclair/typebox";
import { UuidSchema } from "./ids.js";

const V3 = Type.Literal(3);
const Ephemeral = Type.Literal(false);
const isoTimestamp = Type.String({ pattern: "^\\d{4}-\\d{2}-\\d{2}T\\d{2}:\\d{2}:\\d{2}(?:\\.\\d{1,9})?Z$", maxLength: 40 });
const ToolCallIdSchema = Type.String({ minLength: 1, maxLength: 256 });
const ToolNameSchema = Type.String({ minLength: 1, maxLength: 128 });
const JsonObjectSchema = Type.Record(Type.String({ minLength: 1, maxLength: 256 }), Type.Unknown(), { maxProperties: 1024 });
const TargetSchema = {
  leaseId: UuidSchema,
  targetProcessId: UuidSchema,
  sessionId: UuidSchema,
};

export const DashboardLeaseAcquireSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.lease.acquire"), requestId: UuidSchema, targetProcessId: UuidSchema, sessionId: UuidSchema });
export type DashboardLeaseAcquire = Static<typeof DashboardLeaseAcquireSchema>;
export const DashboardLeaseGrantedSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.lease.granted"), requestId: UuidSchema, ...TargetSchema });
export type DashboardLeaseGranted = Static<typeof DashboardLeaseGrantedSchema>;
export const DashboardLeaseReleaseSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.lease.release"), leaseId: UuidSchema });
export type DashboardLeaseRelease = Static<typeof DashboardLeaseReleaseSchema>;
export const DashboardDisconnectedSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.disconnected"), leaseId: UuidSchema });
export const DashboardLeaseStateSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.lease.state"), ...TargetSchema, state: Type.Union([Type.Literal("gateArmed"), Type.Literal("pauseArmed"), Type.Literal("resumed")]) });
export type DashboardLeaseState = Static<typeof DashboardLeaseStateSchema>;
export const DashboardLeaseErrorSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.lease.error"), leaseId: UuidSchema, code: Type.Literal("target_unavailable") });
export const DashboardLeaseRevokedSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("dashboard.lease.revoked"), leaseId: UuidSchema, reason: Type.Literal("target_replaced") });

export const GatePolicySchema = Type.Object({ protocolVersion: V3, type: Type.Literal("tool_gate.policy"), ...TargetSchema, failMode: Type.Union([Type.Literal("failOpen"), Type.Literal("failClosed")]), timeoutMs: Type.Integer({ minimum: 1, maximum: 300_000 }), includeArguments: Type.Boolean(), persistent: Type.Boolean(), persistable: Ephemeral });
export type GatePolicy = Static<typeof GatePolicySchema>;
export const ToolGateRequestSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("tool_gate.request"), ...TargetSchema, toolCallId: ToolCallIdSchema, toolName: ToolNameSchema, persistable: Ephemeral, metadata: Type.Object({ argumentKeys: Type.Array(Type.String({ maxLength: 256 }), { maxItems: 1024 }) }), arguments: Type.Optional(JsonObjectSchema) });
export type ToolGateRequest = Static<typeof ToolGateRequestSchema>;
export const ToolGateDecisionSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("tool_gate.decision"), ...TargetSchema, toolCallId: ToolCallIdSchema, decision: Type.Union([Type.Literal("allow"), Type.Literal("deny")]), replacementArgs: Type.Optional(JsonObjectSchema), persistable: Ephemeral });
export type ToolGateDecision = Static<typeof ToolGateDecisionSchema>;

export const PauseArmSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("pause.arm"), ...TargetSchema, deadline: isoTimestamp, disconnectMode: Type.Union([Type.Literal("resume"), Type.Literal("holdUntilDeadline")]), persistable: Ephemeral });
export type PauseArm = Static<typeof PauseArmSchema>;
export const PauseResumeSchema = Type.Object({ protocolVersion: V3, type: Type.Literal("pause.resume"), ...TargetSchema });
export type PauseResume = Static<typeof PauseResumeSchema>;
