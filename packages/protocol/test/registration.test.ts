import assert from "node:assert/strict";
import { test } from "node:test";
import { ProducerLedger } from "../src/index.ts";

const event = (sequence: number, eventId = `00000000-0000-4000-8000-${String(sequence).padStart(12, "0")}`) => ({ protocolVersion: 3, type: "event.publish", eventId, processId: "10000000-0000-4000-8000-000000000001", processInstanceId: "20000000-0000-4000-8000-000000000001", processSequence: sequence, occurredAt: "2026-01-01T00:00:00.000Z", event: { type: "agent_start", runId: "30000000-0000-4000-8000-000000000001" } });

test("producer commits contiguous events before acknowledgement and deduplicates identical payloads", () => {
  const ledger = new ProducerLedger();
  assert.equal(ledger.commit(event(1)).cursor, 1);
  assert.equal(ledger.commit(event(1)).duplicate, true);
  assert.throws(() => ledger.commit(event(3)), (e: any) => e.code === "process_sequence_gap" && e.details.expectedSequence === 2);
  assert.throws(() => ledger.commit({ ...event(1), occurredAt: "2026-02-01T00:00:00.000Z" }), (e: any) => e.code === "event_conflict");
});
