import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { homedir, networkInterfaces, type NetworkInterfaceInfo } from 'node:os';
import { join } from 'node:path';
import qrcode from 'qrcode-terminal';
import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';

type Status = { enabled: boolean; host: string; port: number; clients?: number; maxClients?: number; connected?: boolean };
export interface PairingBridge {
  status(): Promise<Status> | Status;
  issuePairing(): Promise<{ deepLink: string }>;
  rotateToken(): Promise<unknown>;
  setEnabled(enabled: boolean): Promise<unknown>;
  ensureConnected(): Promise<unknown>;
}
type Options = { getBridge(): PairingBridge | undefined; makeQr?: (value: string) => string; openAndroid?: (value: string) => Promise<unknown> };

export function reachablePairingHost(host: string, interfaces: NodeJS.Dict<NetworkInterfaceInfo[]> = networkInterfaces()): string {
  if (host !== '0.0.0.0' && host !== '::') return host;
  const candidates = Object.entries(interfaces).flatMap(([name, values]) => (values ?? []).filter(value => !value.internal && value.family === 'IPv4').map(value => ({ name, address: value.address })));
  return candidates.find(value => /tailscale|tun|wireguard|wg/i.test(value.name) || /^100\.(?:6[4-9]|[7-9]\d|1[01]\d|12[0-7])\./.test(value.address))?.address ?? candidates[0]?.address ?? '127.0.0.1';
}

export function pairingWarningLines(secretMaterial: string): string[] { return ['WARNING: Secret pairing material follows. Anyone who can see this QR/deep link/token can control the selected Pi process until you rotate the token.', 'Do not paste it into public issues, logs, screenshots, or chat.', secretMaterial]; }
export function redactedStatusLines(status: Status, host = status.host): string[] { return [`Remote control: ${status.enabled ? 'enabled' : 'disabled'} (shared daemon)`, `Bridge: ${status.connected === false ? 'reconnecting' : 'connected'}`, `WebSocket: ws://${host}:${status.port}?token=[redacted]`, `Android deep link: pi-remote://${host}:${status.port}?token=[redacted]`, `Authenticated clients: ${status.clients ?? 0}/${status.maxClients ?? 3}`, 'Pairing QR/deep link: run /remote-control-qr or /remote-control-android']; }
function qr(value: string): string { let output = ''; qrcode.generate(value, { small: true }, value => { output = value; }); return output; }
function adbPath(): string { const values = [process.env.ADB, process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, 'platform-tools', process.platform === 'win32' ? 'adb.exe' : 'adb') : undefined, join(homedir(), 'AppData', 'Local', 'Android', 'Sdk', 'platform-tools', 'adb.exe'), 'adb'].filter(Boolean) as string[]; return values.find(value => value === 'adb' || existsSync(value)) ?? 'adb'; }
async function adbOpen(link: string): Promise<void> { await new Promise<void>((resolve, reject) => execFile(adbPath(), ['shell','am','start','-a','android.intent.action.VIEW','-d',link,'com.pragmaticcoder.piremote'], { windowsHide: true }, error => error ? reject(error) : resolve())); }
function notifyError(ctx: ExtensionContext): void { ctx.ui.notify('Remote daemon management operation failed. No credentials were logged; Pi remains available.', 'error'); }
function bridgeOrNotify(options: Options, ctx: ExtensionContext): PairingBridge | undefined { const value = options.getBridge(); if (!value) ctx.ui.notify('Remote daemon bridge is not active for this session.', 'warning'); return value; }

export function registerPairingCommands(pi: ExtensionAPI, options: Options): void {
  pi.registerCommand('remote-control', { description: 'Show shared remote-control daemon status', handler: async (_args, ctx) => { const bridge = bridgeOrNotify(options, ctx); if (!bridge) return; try { ctx.ui.notify(redactedStatusLines(await bridge.status()).join('\n'), 'info'); } catch { notifyError(ctx); } } });
  pi.registerCommand('remote-control-qr', { description: 'Show a scoped Android pairing QR code', handler: async (_args, ctx) => { const bridge = bridgeOrNotify(options, ctx); if (!bridge) return; try { const { deepLink } = await bridge.issuePairing(); ctx.ui.notify([...pairingWarningLines('Scan with your phone camera to open Pi Remote:'), '', (options.makeQr ?? qr)(deepLink), '', deepLink].join('\n'), 'warning'); } catch { notifyError(ctx); } } });
  pi.registerCommand('remote-control-android', { description: 'Open Pi Remote on an attached Android device', handler: async (_args, ctx) => { const bridge = bridgeOrNotify(options, ctx); if (!bridge) return; try { const { deepLink } = await bridge.issuePairing(); await (options.openAndroid ?? adbOpen)(deepLink); ctx.ui.notify(pairingWarningLines(`Opened Pi Remote on Android.\n${deepLink}`).join('\n'), 'warning'); } catch { notifyError(ctx); } } });
  pi.registerCommand('remote-control-rotate-token', { description: 'Rotate Android v2 credentials and disconnect paired clients', handler: async (_args, ctx) => { const bridge = bridgeOrNotify(options, ctx); if (!bridge) return; try { await bridge.rotateToken(); ctx.ui.notify('Android credentials rotated in the shared daemon. Existing Android clients must pair again.', 'warning'); } catch { notifyError(ctx); } } });
  pi.registerCommand('remote-control-disable', { description: 'Globally disable Pi Remote', handler: async (_args, ctx) => { const bridge = bridgeOrNotify(options, ctx); if (!bridge) return; try { await bridge.setEnabled(false); ctx.ui.notify('Remote control disabled in the shared daemon. This affects other Pi processes.', 'warning'); } catch { notifyError(ctx); } } });
  pi.registerCommand('remote-control-enable', { description: 'Enable Pi Remote through the shared daemon', handler: async (_args, ctx) => { const bridge = bridgeOrNotify(options, ctx); if (!bridge) return; try { await bridge.setEnabled(true); await bridge.ensureConnected(); ctx.ui.notify('Remote control enabled in the shared daemon for TUI and RPC sessions.', 'info'); } catch { notifyError(ctx); } } });
}
