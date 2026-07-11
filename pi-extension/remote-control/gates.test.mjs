import assert from 'node:assert/strict';
import { test } from 'node:test';
import { Type } from '@sinclair/typebox';
import { GateController, PauseController } from './gates.ts';

const tool = { name: 'demo', parameters: Type.Object({ count: Type.Integer({ minimum: 1 }), label: Type.String() }) };
function gate(options = {}) {
  const sent = [], audits = [];
  const controller = new GateController({
    getTool: name => name === 'demo' ? tool : undefined,
    send: frame => sent.push(frame), audit: record => audits.push(record), isCurrent: () => true,
    ...options,
  });
  return { controller, sent, audits };
}

const event = id => ({ toolCallId: id, toolName: 'demo', input: { count: 1, label: 'original' } });

test('approve, deny and valid complete edit settle once with prototype-safe in-place replacement', async () => {
  const h = gate();
  h.controller.arm({ leaseId: 'lease', failMode: 'failClosed', timeoutMs: 1000, includeArguments: false, persistent: true });
  const approved = event('a'); const pa = h.controller.gate(approved); h.controller.decide({ toolCallId: 'a', leaseId: 'lease', decision: 'allow' });
  assert.equal(await pa, undefined);
  const denied = event('b'); const pd = h.controller.gate(denied); h.controller.decide({ toolCallId: 'b', leaseId: 'lease', decision: 'deny' });
  assert.deepEqual(await pd, { block: true, reason: 'Remote tool policy denied execution' });
  const edited = event('c'); const original = edited.input; const pe = h.controller.gate(edited);
  h.controller.decide({ toolCallId: 'c', leaseId: 'lease', decision: 'allow', replacementArgs: { count: 2, label: 'edited' } });
  assert.equal(await pe, undefined);
  assert.equal(edited.input, original);
  assert.deepEqual(edited.input, { count: 2, label: 'edited' });
  assert.equal(Object.getPrototypeOf(edited.input), Object.prototype);
  assert.equal(h.controller.decide({ toolCallId: 'c', leaseId: 'lease', decision: 'deny' }), 'stale');
});

test('invalid complete schema, unresolved refs, dangerous keys and validator throws never partially mutate input', async () => {
  for (const [name, replacement, customTool] of [
    ['missing required', { count: 2 }, tool],
    ['nested prototype key', JSON.parse('{"count":2,"label":"x","nested":{"__proto__":1}}'), Type.Object({ count: Type.Integer(), label: Type.String(), nested: Type.Any() }) && tool],
    ['unresolved ref', { count: 2, label: 'x' }, { name: 'demo', parameters: { $ref: 'missing' } }],
  ]) {
    const h = gate({ getTool: () => customTool });
    h.controller.arm({ leaseId: 'lease', failMode: 'failClosed', timeoutMs: 1000, includeArguments: false, persistent: true });
    const call = event(name); const before = JSON.stringify(call.input); const pending = h.controller.gate(call);
    h.controller.decide({ toolCallId: name, leaseId: 'lease', decision: 'allow', replacementArgs: replacement });
    assert.deepEqual(await pending, { block: true, reason: 'Remote tool policy denied execution' });
    assert.equal(JSON.stringify(call.input), before);
  }
});

test('one-use fail-open policy is consumed by an unknown-tool call', async () => {
  const h = gate({ getTool: () => undefined });
  h.controller.arm({ leaseId: 'lease', failMode: 'failOpen', timeoutMs: 1000, includeArguments: false, persistent: false });
  assert.equal(await h.controller.gate({ toolCallId: 'unknown', toolName: 'missing', input: {} }), undefined);
  assert.equal(await h.controller.gate(event('next')), undefined);
  assert.equal(h.sent.length, 0);
});

test('unknown-tool decoy cannot consume one-use fail-closed supervision of the next known call', async () => {
  const h = gate();
  h.controller.arm({ leaseId: 'lease', failMode: 'failClosed', timeoutMs: 1000, includeArguments: false, persistent: false });

  assert.deepEqual(await h.controller.gate({ toolCallId: 'decoy', toolName: 'missing', input: {} }),
    { block: true, reason: 'Remote tool policy denied execution' });
  assert.equal(h.sent.length, 0);

  const supervised = h.controller.gate(event('known'));
  assert.equal(h.sent.length, 1);
  h.controller.decide({ toolCallId: 'known', leaseId: 'lease', decision: 'deny' });
  assert.deepEqual(await supervised, { block: true, reason: 'Remote tool policy denied execution' });

  assert.equal(await h.controller.gate(event('after-one-use')), undefined);
  assert.equal(h.sent.length, 1);
});

test('arguments are disclosed only for trusted ephemeral policy and never enter audit', async () => {
  const h = gate();
  h.controller.arm({ leaseId: 'trusted', failMode: 'failOpen', timeoutMs: 1000, includeArguments: true, persistent: false });
  const call = event('secret'); const pending = h.controller.gate(call);
  assert.deepEqual(h.sent[0].arguments, call.input);
  assert.equal(h.sent[0].persistable, false);
  h.controller.decide({ toolCallId: 'secret', leaseId: 'trusted', decision: 'allow' });
  await pending;
  assert.doesNotMatch(JSON.stringify(h.audits), /original/);
});

test('timeout and controlling-dashboard disconnect obey fail-open/fail-closed while daemon loss is not mistaken for a lease', async () => {
  for (const failMode of ['failOpen', 'failClosed']) {
    const h = gate();
    h.controller.arm({ leaseId: 'lease', failMode, timeoutMs: 5, includeArguments: false, persistent: true });
    const timeout = await h.controller.gate(event(`timeout-${failMode}`));
    assert.deepEqual(timeout, failMode === 'failOpen' ? undefined : { block: true, reason: 'Remote tool policy unavailable' });
    const pending = h.controller.gate(event(`disconnect-${failMode}`));
    h.controller.disconnectLease('lease');
    assert.deepEqual(await pending, failMode === 'failOpen' ? undefined : { block: true, reason: 'Remote tool policy unavailable' });
  }
});

test('parallel calls, abort and shutdown settle all waiters without edits', async () => {
  const h = gate();
  h.controller.arm({ leaseId: 'lease', failMode: 'failOpen', timeoutMs: 1000, includeArguments: false, persistent: true });
  const one = event('one'), two = event('two');
  const waits = [h.controller.gate(one), h.controller.gate(two)];
  h.controller.abort();
  assert.deepEqual(await Promise.all(waits), [{ block: true, reason: 'Tool call cancelled' }, { block: true, reason: 'Tool call cancelled' }]);
  h.controller.shutdown();
});

test('pause waits only at safe boundaries and resume/shutdown releases matching generation', async () => {
  const pause = new PauseController();
  pause.arm({ generation: 1, deadline: Date.now() + 1000 });
  assert.equal(pause.state, 'armed');
  let released = false;
  const waiter = pause.boundary('context', 1).then(() => { released = true; });
  await new Promise(resolve => setTimeout(resolve, 5));
  assert.equal(released, false);
  assert.equal(pause.state, 'paused');
  pause.resume(1);
  await waiter;
  pause.arm({ generation: 2, deadline: Date.now() + 1000 });
  const shutdownWaiter = pause.boundary('tool_call', 2);
  pause.shutdown();
  await shutdownWaiter;
  assert.equal(pause.state, 'idle');
});
