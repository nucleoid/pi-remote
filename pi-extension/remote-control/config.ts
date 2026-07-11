import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
export interface RemoteConfig { enabled: boolean; host: string; port: number; maxClients: number; pathPolicy: 'none' | 'basename' | 'full'; }
export const profileRoot = process.env.PI_REMOTE_PROFILE ?? join(homedir(), '.pi', 'agent', 'pi-remote');
export function loadBridgeConfig(root = profileRoot): RemoteConfig {
  const path = join(root, 'daemon.json');
  let value: any = {};
  try { value = JSON.parse(readFileSync(path, 'utf8')); } catch { /* defaults */ }
  const config: RemoteConfig = { enabled: value.enabled !== false, host: typeof value.host === 'string' ? value.host : '127.0.0.1', port: Number.isInteger(value.port) ? value.port : 37891, maxClients: Number.isInteger(value.maxClients) ? value.maxClients : 3, pathPolicy: ['none','basename','full'].includes(value.pathPolicy) ? value.pathPolicy : 'basename' };
  return config;
}
export function writeEnabled(enabled: boolean, root = profileRoot): void {
  const path = join(root, 'daemon.json'); mkdirSync(root, { recursive: true, mode: 0o700 });
  let value: any = {}; if (existsSync(path)) try { value = JSON.parse(readFileSync(path, 'utf8')); } catch {}
  writeFileSync(path, JSON.stringify({ ...value, enabled }, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(root, 0o700); chmodSync(path, 0o600); } catch {}
}
