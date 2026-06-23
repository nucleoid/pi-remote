import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildUserContent,
  remoteHello,
  REMOTE_CONTROL_MAX_PAYLOAD,
  redactedStatusLines,
  pairingWarningLines,
  authenticateRequest,
  createAuthLimiter,
  authenticatedClientCount,
} from './index.ts';

const config = {
  enabled: true,
  host: '0.0.0.0',
  port: 37891,
  token: 'super-secret-token',
  allowNoAuthFromLoopback: false,
  maxClients: 1,
  failedAuthLimit: 2,
  failedAuthWindowMs: 60_000,
};

test('binary files are represented as attachment metadata without dumping bytes', () => {
  const content = buildUserContent('please inspect', [], [
    {
      name: 'spec.pdf',
      mimeType: 'application/pdf',
      encoding: 'base64',
      data: Buffer.from('%PDF-1.7 hidden bytes').toString('base64'),
    },
  ]);

  assert.equal(Array.isArray(content), true);
  const text = JSON.stringify(content);
  assert.match(text, /Attached binary file: spec\.pdf \(application\/pdf, 21 B\)/);
  assert.doesNotMatch(text, /%PDF-1\.7/);
  assert.doesNotMatch(text, /JVBER|hidden bytes/);
});

test('spoofed image payloads are rejected before forwarding to Pi', () => {
  assert.throws(
    () => buildUserContent('', [{ name: 'fake.png', mimeType: 'image/png', data: Buffer.from('%PDF-1.7').toString('base64') }], []),
    /Invalid image attachment/,
  );
});

test('malformed and oversized binary files are rejected before decoding', () => {
  assert.throws(
    () => buildUserContent('', [], [{ name: 'bad.pdf', mimeType: 'application/pdf', encoding: 'base64', data: 'not base64!!!' }]),
    /Invalid base64 attachment/,
  );
  assert.throws(
    () => buildUserContent('', [], [{ name: 'huge.pdf', mimeType: 'application/pdf', encoding: 'base64', data: 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 1) / 3) * 4) }]),
    /exceeds 5MB/,
  );
});

test('hello advertises binary file attachment capability', () => {
  assert.equal(remoteHello({}).protocolVersion, 2);
  assert.equal(remoteHello({}).capabilities.binaryFileAttachments, true);
});

test('websocket payload cap leaves room for four bounded binary attachments', () => {
  assert.ok(REMOTE_CONTROL_MAX_PAYLOAD >= 28 * 1024 * 1024);
  assert.ok(REMOTE_CONTROL_MAX_PAYLOAD < 40 * 1024 * 1024);
});

test('status output is redacted by default and exposes loopback bypass state', () => {
  const lines = redactedStatusLines(config, '100.64.0.10', 37891, '/tmp/remote-control.json');
  const text = lines.join('\n');
  assert.match(text, /WebSocket: ws:\/\/100\.64\.0\.10:37891\?token=\[redacted\]/);
  assert.match(text, /Android deep link: pi-remote:\/\/100\.64\.0\.10:37891\?token=\[redacted\]/);
  assert.match(text, /Loopback no-auth bypass: disabled/);
  assert.doesNotMatch(text, /super-secret-token/);
});

test('explicit pairing output includes warning and token-bearing material', () => {
  const lines = pairingWarningLines('pi-remote://100.64.0.10:37891?token=super-secret-token');
  const text = lines.join('\n');
  assert.match(text, /Secret pairing material/);
  assert.match(text, /token=super-secret-token/);
});

test('authentication never allows non-loopback bypass and rate limits repeated failures', () => {
  const limiter = createAuthLimiter(2, 60_000);
  const req = (remoteAddress, url = '/?token=wrong') => ({ socket: { remoteAddress }, url, headers: { host: 'localhost' } });

  const loopbackConfig = { ...config, allowNoAuthFromLoopback: true };
  assert.equal(authenticateRequest(req('::1', '/'), loopbackConfig, limiter).ok, true);
  assert.equal(authenticateRequest(req('100.64.0.22', '/'), loopbackConfig, limiter).ok, false);
  assert.equal(authenticateRequest(req('100.64.0.23'), config, limiter).reason, 'unauthorized');
  assert.equal(authenticateRequest(req('100.64.0.23'), config, limiter).reason, 'rate_limited');
  assert.equal(authenticateRequest(req('100.64.0.23', '/?token=super-secret-token'), config, limiter).ok, false);
});

test('authentication treats malformed Host headers as unauthorized instead of throwing', () => {
  const limiter = createAuthLimiter(2, 60_000);
  const malformedHostReq = {
    socket: { remoteAddress: '100.64.0.24' },
    url: '/?token=wrong',
    headers: { host: 'bad host' },
  };

  assert.doesNotThrow(() => authenticateRequest(malformedHostReq, config, limiter));
  assert.deepEqual(authenticateRequest(malformedHostReq, config, limiter), { ok: false, reason: 'rate_limited' });
});

test('authenticated client count ignores rejected/unauthenticated sockets', () => {
  const clients = new Set([
    { readyState: 1, piRemoteAuthenticated: true },
    { readyState: 1, piRemoteAuthenticated: false },
    { readyState: 3, piRemoteAuthenticated: true },
  ]);
  assert.equal(authenticatedClientCount(clients), 1);
});
