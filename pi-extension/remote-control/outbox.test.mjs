import assert from 'node:assert/strict';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { DurableOutbox } from './outbox.ts';

const ids = { processId: 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa', processInstanceId: 'bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb' };

async function make(options = {}) {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-outbox-'));
  return new DurableOutbox({ path: join(root, 'spool.json'), ...ids, maxItems: 8, maxBytes: 16_384, ...options });
}

test('coalesces unsequenced deltas then assigns immutable ordered sequence and event ids', async () => {
  const box = await make();
  box.observe({ type: 'assistant_delta', text: 'a' }, { coalesceKey: 'assistant' });
  box.observe({ type: 'assistant_delta', text: 'b' }, { coalesceKey: 'assistant' });
  box.observe({ type: 'turn_end', runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { mandatory: true });
  const first = box.assign();
  assert.equal(first.length, 2);
  assert.equal(first[0].event.text, 'ab');
  assert.deepEqual(first.map(x => x.processSequence), [1, 2]);
  const snapshot = JSON.stringify(first);
  box.observe({ type: 'assistant_delta', text: 'later' }, { coalesceKey: 'assistant' });
  assert.equal(JSON.stringify(first), snapshot, 'assigned records must never mutate');
});

test('persists assigned records, discards daemon-committed prefix, and resumes the rest without renumbering', async () => {
  const box = await make();
  box.observe({ type: 'session_start', sessionId: '11111111-1111-4111-8111-111111111111' }, { mandatory: true });
  box.observe({ type: 'agent_start', runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { mandatory: true });
  const original = box.assign();
  const reopened = new DurableOutbox({ path: box.path, ...ids, maxItems: 8, maxBytes: 16_384 });
  assert.deepEqual(reopened.resumeFrom(2), [original[1]]);
  reopened.acknowledge(2);
  assert.deepEqual(reopened.resumeFrom(3), []);
});

test('bounded pressure never blocks and records explicit gap plus latest snapshot degradation', async () => {
  const box = await make({ maxItems: 4, maxBytes: 2048 });
  const started = performance.now();
  for (let i = 0; i < 5000; i++) box.observe({ type: 'assistant_delta', text: `delta-${i}` }, { coalesceKey: `key-${i}` });
  box.observe({ type: 'process_state', state: { isIdle: false, marker: 'latest' } }, { mandatory: true, snapshot: true });
  assert.ok(performance.now() - started < 500, 'outage handling must remain nonblocking');
  const events = box.assign().map(x => x.event);
  assert.ok(events.length <= 4);
  assert.ok(events.some(x => x.type === 'gap'));
  assert.ok(events.some(x => x.type === 'process_state' && x.state.marker === 'latest'));
  assert.ok(box.bytes <= 2048);
});

test('degradation clears only after assigned gap and latest snapshot are acknowledged', async () => {
  const box = await make({ maxItems: 3, maxBytes: 2048 });
  for (let i = 0; i < 20; i++) box.observe({ type: 'assistant_delta', text: `lost-${i}` }, { coalesceKey: `k-${i}` });
  box.observe({ type: 'process_state', state: { marker: 'recovery' } }, { snapshot: true, mandatory: true });
  const recovery = box.assign();
  box.observe({ type: 'assistant_delta', text: 'before-ack' });
  assert.equal(box.assign().some(x => x.event.text === 'before-ack'), false);
  box.acknowledge(recovery.at(-1).processSequence);
  box.observe({ type: 'assistant_delta', text: 'after-ack' });
  assert.equal(box.assign().some(x => x.event.text === 'after-ack'), true);
});

test('daemon cursor conflict starts explicit recovery rather than silently skipping', async () => {
  const box = await make();
  box.observe({ type: 'agent_start', runId: 'cccccccc-cccc-4ccc-8ccc-cccccccccccc' }, { mandatory: true });
  box.assign();
  assert.throws(() => box.resumeFrom(9), /resume_conflict/);
});
