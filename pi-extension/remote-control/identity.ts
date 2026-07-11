import { randomUUID } from 'node:crypto';
import { chmodSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

const IDENTITY_SYMBOL = Symbol.for('@nucleoid/pi-remote/process-identity/v1');
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export interface ProcessIdentity {
  hostId: string;
  processId: string;
  processInstanceId: string;
  parentProcessId?: string;
  runId: string;
  generation: number;
}

export interface SessionIdentity extends ProcessIdentity {
  sessionId: string;
}

type IdentityOptions = {
  profileRoot?: string;
  env?: Record<string, string | undefined>;
  globalObject?: Record<PropertyKey, unknown>;
};

function validId(value: unknown): value is string {
  return typeof value === 'string' && value.length === 36 && UUID.test(value);
}

function hostId(profileRoot: string): string {
  const path = join(profileRoot, 'host-id');
  mkdirSync(profileRoot, { recursive: true, mode: 0o700 });
  try {
    const value = readFileSync(path, 'utf8').trim();
    if (validId(value)) return value;
  } catch { /* create below */ }
  const value = randomUUID();
  writeFileSync(path, `${value}\n`, { encoding: 'utf8', mode: 0o600 });
  try { chmodSync(profileRoot, 0o700); chmodSync(path, 0o600); } catch { /* best effort */ }
  return value;
}

export function resolveProcessIdentity(options: IdentityOptions = {}): ProcessIdentity {
  const env = options.env ?? process.env;
  const globalObject = options.globalObject ?? (globalThis as unknown as Record<PropertyKey, unknown>);
  const existing = globalObject[IDENTITY_SYMBOL] as ProcessIdentity | undefined;
  if (existing) {
    delete env.PI_REMOTE_PROCESS_ID;
    env.PI_REMOTE_PARENT_PROCESS_ID = existing.processId;
    env.PI_REMOTE_RUN_ID = existing.runId;
    return existing;
  }

  const explicit = validId(env.PI_REMOTE_PROCESS_ID) ? env.PI_REMOTE_PROCESS_ID : undefined;
  const parentProcessId = validId(env.PI_REMOTE_PARENT_PROCESS_ID) ? env.PI_REMOTE_PARENT_PROCESS_ID : undefined;
  const runId = validId(env.PI_REMOTE_RUN_ID) ? env.PI_REMOTE_RUN_ID : randomUUID();
  const identity: ProcessIdentity = {
    hostId: hostId(options.profileRoot ?? join(homedir(), '.pi', 'agent', 'pi-remote')),
    processId: explicit ?? randomUUID(),
    processInstanceId: randomUUID(),
    parentProcessId,
    runId,
    generation: 0,
  };
  globalObject[IDENTITY_SYMBOL] = identity;
  delete env.PI_REMOTE_PROCESS_ID;
  env.PI_REMOTE_PARENT_PROCESS_ID = identity.processId;
  env.PI_REMOTE_RUN_ID = identity.runId;
  return identity;
}

export function beginSessionIdentity(identity: ProcessIdentity, sessionId: string): SessionIdentity {
  if (!validId(sessionId)) throw new Error('invalid_session_id');
  identity.generation += 1;
  return { ...identity, sessionId };
}
