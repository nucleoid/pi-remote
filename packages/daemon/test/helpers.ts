import { randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

export function tempProfile(): { path: string; cleanup(): void } {
  const path = mkdtempSync(join(tmpdir(), "pi-remote-daemon-"));
  return { path, cleanup: () => rmSync(path, { recursive: true, force: true }) };
}
export function tempAgentProfile(): { agentRoot: string; path: string; cleanup(): void } {
  const agentRoot = mkdtempSync(join(tmpdir(), "pi-remote-agent-"));
  return { agentRoot, path: join(agentRoot, "pi-remote"), cleanup: () => rmSync(agentRoot, { recursive: true, force: true }) };
}
export const ids = () => ({ hostId: randomUUID(), processId: randomUUID(), processInstanceId: randomUUID(), sessionId: randomUUID() });
export function event(processId: string, processInstanceId: string, processSequence: number, type = "status") {
  return { protocolVersion: 3, type: "event.publish", eventId: randomUUID(), processId, processInstanceId, processSequence, occurredAt: new Date().toISOString(), event: { type, code: `s${processSequence}` } };
}
