import assert from "node:assert/strict";
import { test } from "node:test";
import { ReplaySubscription } from "../src/subscriptions.js";

test("snapshot/replay handoff closes races and reconnect remains explicitly at-least-once", async () => {
  const history = [{ cursor: 1 }, { cursor: 2 }];
  const delivered: number[] = [];
  const sub = new ReplaySubscription(10);
  sub.buffer({ cursor: 3 });
  await sub.start(0, 2, async () => history, item => delivered.push(item.cursor));
  sub.buffer({ cursor: 3 });
  assert.deepEqual(delivered, [1, 2, 3]);
  assert.equal(sub.lastDeliveredCursor, 3);
  assert.deepEqual(history.filter(e => e.cursor > 1).map(e => e.cursor), [2]);
});

test("replay-window overflow signals the owning connection instead of silently dropping", () => {
  let overflowed = false;
  const sub = new ReplaySubscription(1, () => { overflowed = true; });
  sub.buffer({ cursor: 1 });
  assert.throws(() => sub.buffer({ cursor: 2 }), /replay_backpressure/);
  assert.equal(overflowed, true);
});
