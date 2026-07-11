import assert from "node:assert/strict";
import { test } from "node:test";
import { CommandLedger, parseCommandBody } from "../src/index.ts";

test("known malformed commands do not fall through and unknown commands are explicit", () => {
  assert.throws(() => parseCommandBody({ type: "prompt" }));
  assert.equal(parseCommandBody({ type: "future.command", value: 1 }).type, "unknown");
});

test("duplicate command IDs replay state but changed requests conflict", () => {
  const ledger = new CommandLedger();
  const request = { protocolVersion: 3, type: "command.request", commandId: "40000000-0000-4000-8000-000000000001", targetProcessId: "10000000-0000-4000-8000-000000000001", command: { type: "prompt", text: "hello" } };
  assert.equal(ledger.accept("principal", request).status, "accepted");
  assert.equal(ledger.accept("principal", request).duplicate, true);
  assert.throws(() => ledger.accept("principal", { ...request, command: { type: "prompt", text: "changed" } }), (e: any) => e.code === "command_conflict");
});
