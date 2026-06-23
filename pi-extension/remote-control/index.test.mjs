import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildUserContent, remoteHello, REMOTE_CONTROL_MAX_PAYLOAD } from './index.ts';

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
