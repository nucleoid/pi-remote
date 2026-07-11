import assert from 'node:assert/strict';
import { mkdtemp, readFile, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { resolveProcessIdentity, beginSessionIdentity } from './identity.ts';

const explicit = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa';

test('identity survives module reload and removes explicit process id from child environment', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-id-'));
  const env = { PI_REMOTE_PROCESS_ID: explicit };
  const globalObject = {};
  const first = resolveProcessIdentity({ profileRoot: root, env, globalObject });
  const second = resolveProcessIdentity({ profileRoot: root, env, globalObject });
  assert.equal(first, second);
  assert.equal(first.processId, explicit);
  assert.equal(env.PI_REMOTE_PROCESS_ID, undefined);
  assert.equal(env.PI_REMOTE_PARENT_PROCESS_ID, explicit);
  assert.equal(env.PI_REMOTE_RUN_ID, first.runId);
  assert.match(first.hostId, /^[0-9a-f-]{36}$/);
  assert.match(first.processInstanceId, /^[0-9a-f-]{36}$/);
  assert.equal((await readFile(join(root, 'host-id'), 'utf8')).trim(), first.hostId);
  if (process.platform !== 'win32') assert.equal((await stat(join(root, 'host-id'))).mode & 0o777, 0o600);
});

test('children inherit topology but receive independent process and instance ids', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-id-'));
  const parentEnv = {};
  const parent = resolveProcessIdentity({ profileRoot: root, env: parentEnv, globalObject: {} });
  const childEnv = { ...parentEnv };
  const child = resolveProcessIdentity({ profileRoot: root, env: childEnv, globalObject: {} });
  assert.notEqual(child.processId, parent.processId);
  assert.notEqual(child.processInstanceId, parent.processInstanceId);
  assert.equal(child.parentProcessId, parent.processId);
  assert.equal(child.runId, parent.runId);
});

test('session replacement increments generation while preserving process identity', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-id-'));
  const identity = resolveProcessIdentity({ profileRoot: root, env: {}, globalObject: {} });
  const first = beginSessionIdentity(identity, '11111111-1111-4111-8111-111111111111');
  const replacement = beginSessionIdentity(identity, '22222222-2222-4222-8222-222222222222');
  assert.equal(first.processId, replacement.processId);
  assert.equal(first.processInstanceId, replacement.processInstanceId);
  assert.equal(replacement.generation, first.generation + 1);
  assert.notEqual(first.sessionId, replacement.sessionId);
});

test('invalid or oversized inherited ids are ignored instead of entering registration metadata', async () => {
  const root = await mkdtemp(join(tmpdir(), 'pi-remote-id-'));
  const env = { PI_REMOTE_PROCESS_ID: 'secret-' + 'x'.repeat(1000), PI_REMOTE_PARENT_PROCESS_ID: 'not-a-uuid' };
  const identity = resolveProcessIdentity({ profileRoot: root, env, globalObject: {} });
  assert.match(identity.processId, /^[0-9a-f-]{36}$/);
  assert.equal(identity.parentProcessId, undefined);
  assert.equal(env.PI_REMOTE_PROCESS_ID, undefined);
});
