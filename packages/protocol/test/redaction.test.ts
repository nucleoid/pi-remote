import assert from "node:assert/strict";
import { test } from "node:test";
import { redactForLog, toLoggableEvent } from "../src/index.ts";

test("redaction is content-free, cycle-safe, and never invokes getters", () => {
  let invoked = false;
  const input: any = { token: "secret", prompt: "private", path: "/home/me/work", safe: "ok" };
  Object.defineProperty(input, "danger", { enumerable: true, get() { invoked = true; throw new Error("boom"); } });
  input.self = input;
  const output = redactForLog(input) as any;
  assert.equal(invoked, false);
  assert.equal(output.token, "[redacted]");
  assert.equal(output.prompt, "[redacted]");
  assert.equal(output.self, "[circular]");
  assert.equal(output.danger, "[unavailable]");
});

test("loggable projections exclude event content", () => {
  const logged = JSON.stringify(toLoggableEvent({ eventId: "id", processId: "pid", event: { type: "message", text: "private" } }));
  assert.doesNotMatch(logged, /private/);
});
