import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUserContent, REMOTE_CONTROL_MAX_PAYLOAD } from './attachments.ts';
import { pairingWarningLines, redactedStatusLines } from './pairing.ts';

const config = { enabled: true, host: '0.0.0.0', port: 37891, clients: 0, maxClients: 3 };

test('binary files are represented as attachment metadata without dumping bytes', () => {
  const content = buildUserContent('please inspect', [], [{ name: 'spec.pdf', mimeType: 'application/pdf', encoding: 'base64', data: Buffer.from('%PDF-1.7 hidden bytes').toString('base64') }]);
  const text = JSON.stringify(content);
  assert.match(text, /Attached binary file: spec\.pdf \(application\/pdf, 21 B\)/);
  assert.doesNotMatch(text, /%PDF-1\.7|hidden bytes/);
});

test('spoofed images and malformed or oversized files are rejected', () => {
  assert.throws(() => buildUserContent('', [{ name: 'fake.png', mimeType: 'image/png', data: Buffer.from('%PDF').toString('base64') }], []), /Invalid image attachment/);
  assert.throws(() => buildUserContent('', [], [{ name: 'bad.pdf', mimeType: 'application/pdf', encoding: 'base64', data: 'not base64!!!' }]), /Invalid base64 attachment/);
  assert.throws(() => buildUserContent('', [], [{ name: 'huge.pdf', mimeType: 'application/pdf', encoding: 'base64', data: 'A'.repeat(Math.ceil((5 * 1024 * 1024 + 1) / 3) * 4) }]), /exceeds 5MB/);
});

test('payload cap leaves room for four bounded binary attachments', () => {
  assert.ok(REMOTE_CONTROL_MAX_PAYLOAD >= 28 * 1024 * 1024 && REMOTE_CONTROL_MAX_PAYLOAD < 40 * 1024 * 1024);
});

test('status is redacted and explicit pairing output retains warning', () => {
  const status = redactedStatusLines(config, '100.64.0.10').join('\n');
  assert.match(status, /token=\[redacted\]/);
  assert.doesNotMatch(status, /super-secret-token/);
  assert.match(pairingWarningLines('pi-remote://host:37891?token=super-secret-token').join('\n'), /Secret pairing material/);
});
