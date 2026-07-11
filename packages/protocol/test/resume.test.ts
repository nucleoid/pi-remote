import assert from "node:assert/strict";
import { test } from "node:test";
import { CursorStore } from "../src/index.ts";

test("consumer cursors replay strictly after global cursor with snapshot handoff", () => {
  const store = new CursorStore();
  store.append({ processId: "a", value: 1 });
  store.append({ processId: "b", value: 2 });
  assert.deepEqual(store.replay(1).map((x: any) => x.cursor), [2]);
  assert.equal(store.snapshot({ processes: [] }).throughCursor, 2);
  assert.throws(() => store.replay(3), (e: any) => e.code === "cursor_ahead");
  store.expireThrough(1);
  assert.throws(() => store.replay(0), (e: any) => e.code === "cursor_expired");
});

test("reconnect replay permits deterministic at-least-once deduplication", () => {
  const store = new CursorStore();
  const committed = store.append({ eventId: "same" });
  assert.equal(store.replay(0)[0].eventId, committed.eventId);
  assert.equal(store.replay(0)[0].cursor, committed.cursor);
});
