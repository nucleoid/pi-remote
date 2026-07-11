import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createControlHandler } from './controls.ts';
import { createFakeContext, createFakePi, flushTasks } from './testing.ts';

const processId = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';
const sessionId = '11111111-1111-4111-8111-111111111111';
const commandId = n => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;

function harness(overrides = {}) {
  const frames = [];
  const calls = [];
  const pi = createFakePi();
  pi.sendUserMessage = (...args) => calls.push(['prompt', ...args]);
  pi.setModel = async model => { calls.push(['model', model.id]); return model.id !== 'no-key'; };
  pi.setThinkingLevel = level => calls.push(['thinking', level]);
  const ctx = createFakeContext({
    modelRegistry: { find: (provider, id) => provider === 'openai' ? { provider, id } : undefined },
    abort: () => calls.push(['abort']),
    compact: options => { calls.push(['compact']); queueMicrotask(() => options.onComplete({})); },
    ...overrides,
  });
  const handle = createControlHandler({ pi, ctx, processId, sessionId, generation: 1, isCurrent: () => true, send: frame => frames.push(frame) });
  return { frames, calls, handle, ctx };
}

const request = (id, command, extra = {}) => ({ protocolVersion: 3, type: 'command.request', commandId: commandId(id), targetProcessId: processId, sessionId, command, ...extra });

test('accepted ack is emitted immediately before exactly one invocation and dedupe replays result', async () => {
  const h = harness();
  const value = request(1, { type: 'prompt', text: 'hello' });
  await h.handle(value);
  assert.equal(h.frames[0].type, 'command.ack');
  assert.equal(h.frames[0].status, 'accepted');
  assert.deepEqual(h.calls, [['prompt', 'hello']]);
  assert.equal(h.frames[1].type, 'command.result');
  await h.handle(value);
  assert.deepEqual(h.calls, [['prompt', 'hello']]);
  assert.deepEqual(h.frames.slice(2), h.frames.slice(0, 2));
});

test('target, generation, deadline, duplicate conflicts and unsupported controls reject before invocation', async () => {
  const h = harness();
  await h.handle({ ...request(2, { type: 'abort' }), targetProcessId: commandId(99) });
  await h.handle({ ...request(3, { type: 'abort' }), sessionId: commandId(98) });
  await h.handle(request(4, { type: 'abort' }, { deadline: '2000-01-01T00:00:00.000Z' }));
  for (const type of ['queue_mode', 'retry', 'force_terminate']) await h.handle(request(10 + h.frames.length, { type }));
  assert.deepEqual(h.calls, []);
  assert.ok(h.frames.every(frame => frame.type === 'command.ack' && frame.status === 'rejected'));
});

test('busy prompt requires explicit steer or follow-up policy and validates blank payloads', async () => {
  const h = harness({ isIdle: () => false });
  await h.handle(request(20, { type: 'prompt', text: 'busy' }));
  await h.handle(request(21, { type: 'prompt', text: '   ' }));
  await h.handle(request(22, { type: 'prompt', text: 'busy', deliverAs: 'steer' }));
  assert.deepEqual(h.calls, [['prompt', 'busy', { deliverAs: 'steer' }]]);
  assert.equal(h.frames[0].status, 'rejected');
  assert.equal(h.frames[1].status, 'rejected');
});

test('model, thinking, compaction and abort use only public extension APIs', async () => {
  const h = harness();
  await h.handle(request(30, { type: 'model', provider: 'openai', id: 'gpt' }));
  await h.handle(request(31, { type: 'thinking', level: 'high' }));
  await h.handle(request(32, { type: 'compact' }));
  await flushTasks();
  await h.handle(request(33, { type: 'abort' }));
  assert.deepEqual(h.calls, [['model', 'gpt'], ['thinking', 'high'], ['compact'], ['abort']]);
  assert.ok(h.frames.filter(x => x.type === 'command.result').every(x => x.status === 'completed'));
});
