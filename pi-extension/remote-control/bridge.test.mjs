import assert from 'node:assert/strict';
import { test } from 'node:test';
import remoteControl, { createRemoteControl } from './index.ts';
import { createBridgeRuntime } from './bridge.ts';
import { createFakePi, createFakeContext, flushTasks } from './testing.ts';
import { LocalDaemon } from '@nucleoid/pi-remote-daemon';
import { WebSocket } from 'ws';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { Type } from '@sinclair/typebox';

for (const mode of ['tui', 'rpc']) {
  test(`${mode} session starts one daemon bridge without touching stdout`, async () => {
    const calls = [];
    const pi = createFakePi();
    createRemoteControl({
      createRuntime: async (_pi, ctx) => ({
        start: async () => calls.push(['start', ctx.mode]),
        shutdown: async () => calls.push(['shutdown', ctx.mode]),
        status: () => ({ connected: true }),
      }),
    })(pi);
    assert.deepEqual(calls, [], 'extension factory must be resource-free');
    const ctx = createFakeContext({ mode });
    await pi.emit('session_start', {}, ctx);
    await flushTasks();
    assert.deepEqual(calls, [['start', mode]]);
    await pi.emit('session_shutdown', {}, ctx);
    assert.deepEqual(calls, [['start', mode], ['shutdown', mode]]);
    assert.equal('stdout' in calls.flat(), false);

  });
}

test('json and print sessions never create observation resources', async () => {
  for (const mode of ['json', 'print']) {
    let created = 0;
    const pi = createFakePi();
    createRemoteControl({ createRuntime: async () => { created++; throw new Error('must not run'); } })(pi);
    await pi.emit('session_start', {}, createFakeContext({ mode }));
    await flushTasks();
    assert.equal(created, 0);
  }
});

test('duplicate starts and shutdown-before-connect are idempotent and startup failures are contained', async () => {
  let starts = 0;
  let shutdowns = 0;
  const pi = createFakePi();
  createRemoteControl({ createRuntime: async () => ({
    start: async () => { starts++; await new Promise(resolve => setTimeout(resolve, 5)); throw new Error('credential token must stay private'); },
    shutdown: async () => { shutdowns++; },
    status: () => ({ connected: false }),
  }) })(pi);
  const ctx = createFakeContext({ mode: 'tui' });
  const first = pi.emit('session_start', {}, ctx);
  const duplicate = pi.emit('session_start', {}, ctx);
  await pi.emit('session_shutdown', {}, ctx);
  await Promise.all([first, duplicate]);
  await flushTasks();
  assert.equal(starts, 1);
  assert.equal(shutdowns, 1);
  assert.doesNotMatch(ctx.notifications.join('\n'), /credential token/);
});

test('tool_call hook returns block and preserves mutated input result from the runtime', async () => {
  const pi = createFakePi();
  const input = { command: 'original' };
  createRemoteControl({ createRuntime: async () => ({
    start: async () => {}, shutdown: async () => {}, status: () => ({}),
    event: async (name, event) => { if (name === 'tool_call') { event.input.command = 'edited'; return { block: true, reason: 'policy' }; } },
  }) })(pi);
  const ctx = createFakeContext();
  await pi.emit('session_start', {}, ctx);
  const results = await pi.emit('tool_call', { toolCallId: 'call', toolName: 'bash', input }, ctx);
  assert.deepEqual(results, [{ block: true, reason: 'policy' }]);
  assert.equal(input.command, 'edited');
});

test('default export is a synchronous extension factory', () => {
  const pi = createFakePi();
  assert.equal(remoteControl(pi), undefined);
});

async function waitFor(check, timeout = 3000) {
  const end = Date.now() + timeout;
  while (Date.now() < end) { const value = check(); if (value) return value; await new Promise(resolve => setTimeout(resolve, 10)); }
  throw new Error('timed out');
}

test('real daemon registration bridges v2 commands and only idle settled emits Android agent_end', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-bridge-'));
  const legacyToken = 'android-v2-test-token';
  const daemon = new LocalDaemon({ profileRoot: root, host: '127.0.0.1', port: 0, legacyToken, maxEvents: 1000, maxAgeDays: 1 });
  await daemon.start();
  const prompts = [];
  const pi = createFakePi();
  pi.sendUserMessage = (...args) => prompts.push(args);
  const ctx = createFakeContext({ mode: 'rpc', isIdle: () => true });
  const runtime = await createBridgeRuntime(pi, ctx, {
    profileRoot: root,
    ensureDaemon: async () => ({ endpoint: daemon.endpoint, adminToken: daemon.adminToken }),
    reconnectBaseMs: 10,
  });
  const messages = [];
  let android;
  try {
    await runtime.start();
    await waitFor(() => runtime.status().connected);
    android = new WebSocket(`ws://127.0.0.1:${daemon.endpoint.port}/?token=${legacyToken}`);
    android.on('message', data => messages.push(JSON.parse(String(data))));
    await new Promise((resolve, reject) => { android.once('open', resolve); android.once('error', reject); });
    await waitFor(() => messages.some(x => x.type === 'hello' && x.protocolVersion === 2));
    android.send(JSON.stringify({ type: 'prompt', id: 'p1', text: 'from android' }));
    await waitFor(() => prompts.length === 1);
    await runtime.event('agent_end', {}, ctx);
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(messages.some(x => x.type === 'agent_end'), false);
    await runtime.event('agent_settled', {}, ctx);
    await waitFor(() => messages.some(x => x.type === 'agent_end'));
  } finally {
    android?.close();
    await runtime.shutdown();
    await daemon.stop();
  }
});

test('scoped v2 pairing selects the issuing process when two bridges are live', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-bridge-'));
  const daemon = new LocalDaemon({ profileRoot: root, host: '127.0.0.1', port: 0, maxEvents: 1000, maxAgeDays: 1 });
  await daemon.start();
  const first = await createBridgeRuntime(createFakePi(), createFakeContext(), { profileRoot: root, ensureDaemon: async () => ({ endpoint: daemon.endpoint, adminToken: daemon.adminToken }) });
  const childGlobal = globalThis[Symbol.for('@nucleoid/pi-remote/process-identity/v1')];
  delete globalThis[Symbol.for('@nucleoid/pi-remote/process-identity/v1')];
  const second = await createBridgeRuntime(createFakePi(), createFakeContext({ sessionManager: { getSessionId: () => '22222222-2222-4222-8222-222222222222', getSessionFile: () => undefined, getBranch: () => [] } }), { profileRoot: root, ensureDaemon: async () => ({ endpoint: daemon.endpoint, adminToken: daemon.adminToken }) });
  try {
    await first.start(); await second.start();
    await waitFor(() => first.status().connected && second.status().connected);
    const { deepLink } = await second.issuePairing();
    const url = new URL(deepLink.replace('pi-remote:', 'ws:'));
    const messages = [];
    const android = new WebSocket(url);
    android.on('message', data => messages.push(JSON.parse(String(data))));
    await new Promise((resolve, reject) => { android.once('open', resolve); android.once('error', reject); });
    await waitFor(() => messages.some(x => x.type === 'hello'));
    assert.equal(messages.find(x => x.type === 'hello').processId, second.status().processId);
    android.close();
  } finally {
    await first.shutdown(); await second.shutdown(); await daemon.stop();
    if (childGlobal) globalThis[Symbol.for('@nucleoid/pi-remote/process-identity/v1')] = childGlobal;
    else delete globalThis[Symbol.for('@nucleoid/pi-remote/process-identity/v1')];
  }
});

test('daemon and bridge enforce lease pause and approve deny edit disconnect timeout races end to end', { timeout: 10000 }, async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-bridge-'));
  const daemon = new LocalDaemon({ profileRoot: root, host: '127.0.0.1', port: 0 }); await daemon.start();
  const pi = createFakePi(); pi.getAllTools = () => [{ name: 'demo', parameters: Type.Object({ count: Type.Integer() }) }];
  const ctx = createFakeContext();
  const runtime = await createBridgeRuntime(pi, ctx, { profileRoot: root, ensureDaemon: async () => ({ endpoint: daemon.endpoint, adminToken: daemon.adminToken }), reconnectBaseMs: 10 });
  const dashboard = new WebSocket(`ws://127.0.0.1:${daemon.endpoint.port}/control`, { headers: { authorization: `Bearer ${daemon.adminToken}` } });
  const queue = [], waiters = []; dashboard.on('message', data => { const value = JSON.parse(String(data)), waiter = waiters.shift(); waiter ? waiter(value) : queue.push(value); });
  const next = () => queue.length ? Promise.resolve(queue.shift()) : Promise.race([new Promise(resolve => waiters.push(resolve)), new Promise((_, reject) => setTimeout(() => reject(new Error('dashboard message timeout')), 3000))]);
  const send = value => dashboard.send(JSON.stringify(value));
  try {
    await runtime.start(); await waitFor(() => runtime.status().connected);
    await (dashboard.readyState === WebSocket.OPEN ? Promise.resolve() : new Promise((resolve, reject) => dashboard.once('open', resolve).once('error', reject)));
    send({ protocolVersion: 3, type: 'hello', role: 'client', supportedVersions: [3], capabilities: ['commands.pause','commands.tool_gate'] }); await next();
    const requestId = randomUUID(), targetProcessId = runtime.status().processId, sessionId = ctx.sessionManager.getSessionId();
    send({ protocolVersion: 3, type: 'dashboard.lease.acquire', requestId, targetProcessId, sessionId }); const { leaseId } = await next();
    send({ protocolVersion: 3, type: 'tool_gate.policy', leaseId, targetProcessId, sessionId, failMode: 'failClosed', timeoutMs: 1000, includeArguments: true, persistent: true, persistable: false }); assert.equal((await next()).state, 'gateArmed');
    const decide = async (id, decision, replacementArgs) => { const call = { toolCallId: id, toolName: 'demo', input: { count: 1 } }; const result = runtime.event('tool_call', call, ctx); const request = await next(); assert.equal(request.type, 'tool_gate.request'); send({ protocolVersion: 3, type: 'tool_gate.decision', leaseId, targetProcessId, sessionId, toolCallId: id, decision, ...(replacementArgs ? { replacementArgs } : {}), persistable: false }); return { value: await result, call }; };
    assert.equal((await decide('approve', 'allow')).value, undefined);
    assert.deepEqual((await decide('deny', 'deny')).value, { block: true, reason: 'Remote tool policy denied execution' });
    const edited = await decide('edit', 'allow', { count: 2 }); assert.equal(edited.value, undefined); assert.equal(edited.call.input.count, 2);
    send({ protocolVersion: 3, type: 'pause.arm', leaseId, targetProcessId, sessionId, deadline: new Date(Date.now() + 1000).toISOString(), disconnectMode: 'resume', persistable: false }); assert.equal((await next()).state, 'pauseArmed');
    let paused = true; const pauseWait = runtime.event('context', {}, ctx).then(() => { paused = false; }); await new Promise(resolve => setTimeout(resolve, 20)); assert.equal(paused, true);
    send({ protocolVersion: 3, type: 'pause.resume', leaseId, targetProcessId, sessionId }); assert.equal((await next()).state, 'resumed'); await pauseWait;
    send({ protocolVersion: 3, type: 'tool_gate.policy', leaseId, targetProcessId, sessionId, failMode: 'failClosed', timeoutMs: 10, includeArguments: false, persistent: true, persistable: false }); assert.equal((await next()).state, 'gateArmed');
    const timedWait = runtime.event('tool_call', { toolCallId: 'timeout', toolName: 'demo', input: { count: 1 } }, ctx); assert.equal((await next()).toolCallId, 'timeout'); const timed = await timedWait; assert.deepEqual(timed, { block: true, reason: 'Remote tool policy unavailable' });
    send({ protocolVersion: 3, type: 'tool_gate.policy', leaseId, targetProcessId, sessionId, failMode: 'failOpen', timeoutMs: 1000, includeArguments: false, persistent: true, persistable: false }); assert.equal((await next()).state, 'gateArmed');
    const disconnected = runtime.event('tool_call', { toolCallId: 'disconnect', toolName: 'demo', input: { count: 1 } }, ctx); await next(); dashboard.close(); assert.equal(await disconnected, undefined);
  } finally { dashboard.close(); await runtime.shutdown(); await daemon.stop(); }
});

test('daemon restart resumes retained assigned events and reconnect does not leak work', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-bridge-'));
  let daemon = new LocalDaemon({ profileRoot: root, host: '127.0.0.1', port: 0, maxEvents: 1000, maxAgeDays: 1 });
  await daemon.start();
  let current = daemon;
  const runtime = await createBridgeRuntime(createFakePi(), createFakeContext(), {
    profileRoot: root,
    ensureDaemon: async () => ({ endpoint: current.endpoint, adminToken: current.adminToken }),
    reconnectBaseMs: 10,
  });
  try {
    await runtime.start();
    await waitFor(() => runtime.status().connected);
    const firstInstance = runtime.status().processInstanceId;
    await daemon.stop();
    await runtime.event('agent_start', {}, createFakeContext());
    daemon = new LocalDaemon({ profileRoot: root, host: '127.0.0.1', port: current.endpoint.port, maxEvents: 1000, maxAgeDays: 1 });
    current = daemon;
    await daemon.start();
    await waitFor(() => runtime.status().connected, 5000);
    assert.equal(runtime.status().processInstanceId, firstInstance);
  } finally {
    await runtime.shutdown();
    await daemon.stop();
  }
});
