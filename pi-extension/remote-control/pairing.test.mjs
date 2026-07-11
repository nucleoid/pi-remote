import assert from 'node:assert/strict';
import { test } from 'node:test';
import { registerPairingCommands, pairingWarningLines, redactedStatusLines, reachablePairingHost } from './pairing.ts';
import { createFakeContext, createFakePi } from './testing.ts';

const link = 'pi-remote://100.64.0.10:37891?token=super-secret-token';

test('all six management command names are preserved and delegated to the shared daemon', async () => {
  const pi = createFakePi();
  const calls = [];
  const bridge = {
    status: async () => ({ enabled: true, host: '100.64.0.10', port: 37891, clients: 2, maxClients: 3 }),
    issuePairing: async () => ({ deepLink: link }),
    rotateToken: async () => calls.push('rotate'),
    setEnabled: async enabled => calls.push(['enabled', enabled]),
    ensureConnected: async () => calls.push('ensure'),
  };
  registerPairingCommands(pi, { getBridge: () => bridge, makeQr: value => `QR:${value}`, openAndroid: async value => calls.push(['android', value]) });
  assert.deepEqual([...pi.commands.keys()].sort(), [
    'remote-control', 'remote-control-android', 'remote-control-disable', 'remote-control-enable', 'remote-control-qr', 'remote-control-rotate-token',
  ]);
  const ctx = createFakeContext();
  await pi.commands.get('remote-control-rotate-token').handler('', ctx);
  await pi.commands.get('remote-control-disable').handler('', ctx);
  await pi.commands.get('remote-control-enable').handler('', ctx);
  assert.deepEqual(calls, ['rotate', ['enabled', false], ['enabled', true], 'ensure']);
  assert.match(ctx.notifications.join('\n'), /shared daemon|other Pi processes/i);
});

test('status stays redacted while QR and Android are explicit warned secret output', async () => {
  const pi = createFakePi();
  const calls = [];
  const bridge = {
    status: async () => ({ enabled: true, host: '100.64.0.10', port: 37891, clients: 1, maxClients: 3 }),
    issuePairing: async () => ({ deepLink: link }),
    rotateToken: async () => {}, setEnabled: async () => {}, ensureConnected: async () => {},
  };
  registerPairingCommands(pi, { getBridge: () => bridge, makeQr: value => `QR:${value}`, openAndroid: async value => calls.push(value) });
  const statusCtx = createFakeContext();
  await pi.commands.get('remote-control').handler('', statusCtx);
  assert.doesNotMatch(statusCtx.notifications.join('\n'), /super-secret-token/);
  assert.match(statusCtx.notifications.join('\n'), /token=\[redacted\]/);
  const qrCtx = createFakeContext();
  await pi.commands.get('remote-control-qr').handler('', qrCtx);
  assert.match(qrCtx.notifications.join('\n'), /Secret pairing material/);
  assert.match(qrCtx.notifications.join('\n'), /super-secret-token/);
  const androidCtx = createFakeContext();
  await pi.commands.get('remote-control-android').handler('', androidCtx);
  assert.deepEqual(calls, [link]);
  assert.match(androidCtx.notifications.join('\n'), /Secret pairing material/);
});

test('wildcard LAN and Tailscale pairing selects a reachable host without credential material', () => {
  const interfaces = { eth0: [{ address: '192.168.1.7', family: 'IPv4', internal: false }], tailscale0: [{ address: '100.64.0.10', family: 'IPv4', internal: false }] };
  assert.equal(reachablePairingHost('0.0.0.0', interfaces), '100.64.0.10');
  assert.equal(reachablePairingHost('::', { eth0: interfaces.eth0 }), '192.168.1.7');
  assert.equal(reachablePairingHost('10.0.0.4', interfaces), '10.0.0.4');
});

test('redacted helpers never reveal tokens or internal bridge credentials', () => {
  const text = redactedStatusLines({ enabled: true, host: '127.0.0.1', port: 37891, clients: 0, maxClients: 3 }).join('\n');
  assert.match(text, /pi-remote:\/\/127\.0\.0\.1:37891\?token=\[redacted\]/);
  assert.doesNotMatch(text, /Bearer|adminToken|credential/);
  assert.match(pairingWarningLines(link).join('\n'), /super-secret-token/);
});
