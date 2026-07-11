import assert from "node:assert/strict";
import { test } from "node:test";
import { parseEventBody, toV2Event } from "../src/index.ts";

test("known malformed events do not fall through while unknown events are preserved", () => {
  assert.throws(() => parseEventBody({ type: "agent_settled" }));
  assert.deepEqual(parseEventBody({ type: "future_event", extra: 1 }), { type: "unknown", originalType: "future_event", value: { type: "future_event", extra: 1 } });
});

test("only an idle settled event maps to Android v2 terminal agent_end", () => {
  assert.equal(toV2Event({ type: "agent_end", runId: "30000000-0000-4000-8000-000000000001" }), undefined);
  assert.equal(toV2Event({ type: "agent_settled", runId: "30000000-0000-4000-8000-000000000001", state: { isIdle: false } }), undefined);
  assert.deepEqual(toV2Event({ type: "agent_settled", runId: "30000000-0000-4000-8000-000000000001", state: { isIdle: true } }), { type: "agent_end", state: { isIdle: true } });
});
