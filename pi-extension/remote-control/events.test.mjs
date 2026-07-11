import assert from 'node:assert/strict';
import { test } from 'node:test';
import { PUBLIC_PI_HOOKS, mapPiEvent, publicProcessState } from './events.ts';
import { toV2Event } from '@nucleoid/pi-remote-protocol';

const runId = 'cccccccc-cccc-4ccc-8ccc-cccccccccccc';
const sessionId = '11111111-1111-4111-8111-111111111111';
const ctx = (idle = true) => ({
  cwd: '/safe/project', isIdle: () => idle, hasPendingMessages: () => !idle,
  sessionManager: { getSessionId: () => sessionId, getSessionFile: () => '/private/path/session.jsonl' },
  model: { provider: 'openai', id: 'gpt-test', name: 'secret alias' },
});

test('hook inventory contains only public Pi 0.80.6 extension hooks', () => {
  for (const fake of ['queue_update', 'retry_start', 'retry_end', 'extension_ui', 'rpc_command']) {
    assert.equal(PUBLIC_PI_HOOKS.includes(fake), false);
  }
  for (const real of ['agent_settled', 'message_update', 'tool_call', 'tool_result', 'context', 'input']) {
    assert.equal(PUBLIC_PI_HOOKS.includes(real), true);
  }
  assert.equal(new Set(PUBLIC_PI_HOOKS).size, PUBLIC_PI_HOOKS.length);
});

test('agent_end stays low-level and only idle agent_settled drives Android terminal projection', () => {
  const lowLevel = mapPiEvent('agent_end', { messages: ['private'] }, ctx(true), { runId, sessionId });
  assert.equal(lowLevel.type, 'agent_end');
  assert.equal('willRetry' in lowLevel, false);
  assert.equal(toV2Event(lowLevel), undefined);

  const busySettled = mapPiEvent('agent_settled', {}, ctx(false), { runId, sessionId });
  assert.equal(busySettled, undefined);
  const idleSettled = mapPiEvent('agent_settled', {}, ctx(true), { runId, sessionId });
  assert.equal(idleSettled.type, 'agent_settled');
  assert.deepEqual(toV2Event(idleSettled), { type: 'agent_end', state: idleSettled.state });
});

test('delta, message, tool, model, thinking and compaction hooks map without private attachment or argument leakage', () => {
  assert.deepEqual(mapPiEvent('message_update', { assistantMessageEvent: { type: 'text_delta', delta: 'hi' } }, ctx(), { runId, sessionId }), { type: 'assistant_delta', text: 'hi' });
  assert.equal(mapPiEvent('message_update', { assistantMessageEvent: { type: 'unknown_private', token: 'secret' } }, ctx(), { runId, sessionId }), undefined);
  assert.deepEqual(mapPiEvent('tool_execution_start', { toolCallId: 't1', toolName: 'bash', args: { token: 'secret' } }, ctx(), { runId, sessionId }), { type: 'tool_start', toolCallId: 't1', toolName: 'bash', args: {} });
  assert.deepEqual(mapPiEvent('model_select', { model: { provider: 'openai', id: 'gpt-test', apiKey: 'secret' } }, ctx(), { runId, sessionId }), { type: 'model', provider: 'openai', id: 'gpt-test' });
  assert.equal(mapPiEvent('session_before_compact', {}, ctx(), { runId, sessionId }).phase, 'before');
});

test('coarse state is truthful and metadata is bounded and allowlisted', () => {
  const state = publicProcessState(ctx(false), { pathPolicy: 'basename' });
  assert.equal(state.isIdle, false);
  assert.equal(state.hasPendingMessages, true);
  assert.equal(state.sessionFile, 'session.jsonl');
  assert.equal(state.cwd, 'project');
  assert.deepEqual(state.model, { provider: 'openai', id: 'gpt-test' });
  assert.doesNotMatch(JSON.stringify(state), /private|secret alias/);
});
