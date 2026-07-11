import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { test } from 'node:test';

const root = new URL('../../', import.meta.url);
const extensionRoot = new URL('./', import.meta.url);
const productionFiles = ['index.ts','bridge.ts','identity.ts','events.ts','outbox.ts','controls.ts','gates.ts','attachments.ts','pairing.ts','config.ts'];

test('published extension includes every runtime import and real production dependencies', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', extensionRoot), 'utf8'));
  for (const file of productionFiles) assert.ok(manifest.files.includes(file), `${file} missing from files`);
  assert.equal(manifest.dependencies['@nucleoid/pi-remote-daemon'], '0.1.0');
  assert.equal(manifest.dependencies['@nucleoid/pi-remote-protocol'], '0.1.0');
  assert.equal(manifest.dependencies.ws, '^8.18.0');
  assert.equal(manifest.peerDependencies['@earendil-works/pi-coding-agent'], '*');
  assert.equal(manifest.peerDependencies.typebox, '*');
  assert.equal('pi-coding-agent.d.ts' in manifest.files, false);
});

test('root git/local Pi package ships the complete extension and resolves workspace imports', () => {
  const manifest = JSON.parse(readFileSync(new URL('package.json', root), 'utf8'));
  for (const file of productionFiles) assert.ok(manifest.files.includes(`pi-extension/remote-control/${file}`));
  assert.equal(manifest.dependencies['@nucleoid/pi-remote-daemon'], '0.1.0');
  assert.equal(manifest.dependencies['@nucleoid/pi-remote-protocol'], '0.1.0');
  assert.equal(manifest.pi.extensions[0], './pi-extension/remote-control/index.ts');
});

test('dry-run tarball contains runtime modules and excludes permissive type shim', () => {
  const packed = JSON.parse(execFileSync('npm', ['pack', '--dry-run', '--json'], { cwd: extensionRoot, encoding: 'utf8', shell: process.platform === 'win32' }));
  const files = packed[0].files.map(item => item.path);
  for (const file of productionFiles) assert.ok(files.includes(file), `${file} absent from tarball`);
  assert.equal(files.includes('pi-coding-agent.d.ts'), false);
});
