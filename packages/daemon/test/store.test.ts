import assert from "node:assert/strict";
import { test } from "node:test";
import { DurableStore } from "../src/store.js";
import { event, ids, tempProfile } from "./helpers.js";

test("two producers interleave durable globally ordered events with isolated projections", () => {
  const profile = tempProfile();
  try {
    const store = new DurableStore(`${profile.path}/control.db`);
    const a = ids(), b = ids();
    store.register(a); store.register(b);
    assert.equal(store.appendEvent(event(a.processId, a.processInstanceId, 1)).cursor, 1);
    assert.equal(store.appendEvent(event(b.processId, b.processInstanceId, 1)).cursor, 2);
    assert.equal(store.appendEvent(event(a.processId, a.processInstanceId, 2)).cursor, 3);
    assert.deepEqual(store.replay(0).map(x => x.cursor), [1, 2, 3]);
    assert.equal(store.getProcess(a.processId)?.lastCursor, 3);
    assert.equal(store.getProcess(b.processId)?.lastCursor, 2);
    store.close();
  } finally { profile.cleanup(); }
});

test("tool gate replacement arguments never enter durable command storage", () => {
  const profile = tempProfile();
  try {
    const store = new DurableStore(`${profile.path}/control.db`);
    const producer = ids(); store.register(producer);
    store.acceptCommand("admin", {
      commandId: "gate-command",
      processId: producer.processId,
      processInstanceId: producer.processInstanceId,
      payload: { type: "tool_gate_decision", decision: "allow", replacementArgs: { token: "sqlite-secret" }, persistable: false },
    });
    const row = store.db.prepare("SELECT canonical FROM commands WHERE command_id=?").get("gate-command") as { canonical: string };
    assert.equal(row.canonical.includes("sqlite-secret"), false);
    assert.equal(row.canonical.includes("replacementArgs"), false);
    assert.deepEqual((JSON.parse(row.canonical) as any).value.payload, { type: "tool_gate_decision", decision: "allow", persistable: false });
    store.acceptCommand("admin", {
      commandId: "abort-with-extra-field",
      processId: producer.processId,
      processInstanceId: producer.processInstanceId,
      payload: { type: "abort", replacementArgs: { token: "extra-field-secret" } },
    });
    const persisted = store.db.prepare("SELECT canonical FROM commands ORDER BY command_id").all() as Array<{ canonical: string }>;
    assert.equal(persisted.some(item => item.canonical.includes("replacementArgs") || item.canonical.includes("extra-field-secret")), false);
    store.close();
  } finally { profile.cleanup(); }
});

test("commit-before-ack identities are idempotent and cursor high water is never reused", () => {
  const profile = tempProfile();
  try {
    const store = new DurableStore(`${profile.path}/control.db`);
    const producer = ids(); store.register(producer);
    const first = event(producer.processId, producer.processInstanceId, 1);
    assert.deepEqual(store.appendEvent(first), { cursor: 1, duplicate: false, expectedNextSequence: 2 });
    assert.deepEqual(store.appendEvent(first), { cursor: 1, duplicate: true, expectedNextSequence: 2 });
    assert.throws(() => store.appendEvent({ ...first, occurredAt: new Date(Date.now() + 1).toISOString() }), /event_conflict/);
    store.retain({ maxEvents: 0, maxAgeMs: 0, now: Date.now() });
    assert.equal(store.appendEvent(event(producer.processId, producer.processInstanceId, 2)).cursor, 2);
    store.close();
  } finally { profile.cleanup(); }
});
