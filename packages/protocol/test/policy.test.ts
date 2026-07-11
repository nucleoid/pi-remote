import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { test } from "node:test";
import {
  DashboardLeaseAcquireSchema, DashboardLeaseReleaseSchema, DashboardLeaseStateSchema, GatePolicySchema,
  PauseArmSchema, PauseResumeSchema, ToolGateDecisionSchema, ToolGateRequestSchema,
  validateSchema,
} from "../src/index.js";

const targetProcessId = randomUUID(), sessionId = randomUUID(), leaseId = randomUUID(), requestId = randomUUID();

test("typed ephemeral policy and lease frames accept complete bounded v3 shapes", () => {
  validateSchema(DashboardLeaseAcquireSchema, { protocolVersion: 3, type: "dashboard.lease.acquire", requestId, targetProcessId, sessionId });
  validateSchema(DashboardLeaseReleaseSchema, { protocolVersion: 3, type: "dashboard.lease.release", leaseId });
  validateSchema(DashboardLeaseStateSchema, { protocolVersion: 3, type: "dashboard.lease.state", leaseId, targetProcessId, sessionId, state: "gateArmed" });
  validateSchema(GatePolicySchema, { protocolVersion: 3, type: "tool_gate.policy", leaseId, targetProcessId, sessionId, failMode: "failClosed", timeoutMs: 1000, includeArguments: true, persistent: false, persistable: false });
  validateSchema(PauseArmSchema, { protocolVersion: 3, type: "pause.arm", leaseId, targetProcessId, sessionId, deadline: new Date(Date.now() + 1000).toISOString(), disconnectMode: "resume", persistable: false });
  validateSchema(PauseResumeSchema, { protocolVersion: 3, type: "pause.resume", leaseId, targetProcessId, sessionId });
  validateSchema(ToolGateRequestSchema, { protocolVersion: 3, type: "tool_gate.request", leaseId, targetProcessId, sessionId, toolCallId: "call-1", toolName: "bash", persistable: false, metadata: { argumentKeys: ["command"] }, arguments: { command: "secret" } });
  validateSchema(ToolGateDecisionSchema, { protocolVersion: 3, type: "tool_gate.decision", leaseId, targetProcessId, sessionId, toolCallId: "call-1", decision: "allow", replacementArgs: { command: "edited" }, persistable: false });
});

test("policy and replacement frames cannot claim persistence or carry unbounded policy", () => {
  assert.throws(() => validateSchema(GatePolicySchema, { protocolVersion: 3, type: "tool_gate.policy", leaseId, targetProcessId, sessionId, failMode: "failOpen", timeoutMs: 0, includeArguments: false, persistent: true, persistable: true }));
  assert.throws(() => validateSchema(ToolGateDecisionSchema, { protocolVersion: 3, type: "tool_gate.decision", leaseId, targetProcessId, sessionId, toolCallId: "x", decision: "deny", persistable: true }));
});
