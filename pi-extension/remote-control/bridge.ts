import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { WebSocket } from 'ws';
import { join } from 'node:path';
import { ensureDaemon as ensureLocalDaemon, daemonAdminRequest, type DaemonConnection } from '@nucleoid/pi-remote-daemon/client';
import { buildUserContent } from './attachments.ts';
import { loadBridgeConfig, profileRoot as defaultProfileRoot, writeEnabled } from './config.ts';
import { createControlHandler } from './controls.ts';
import { mapPiEvent, publicProcessState } from './events.ts';
import { GateController, PauseController } from './gates.ts';
import { beginSessionIdentity, resolveProcessIdentity } from './identity.ts';
import { DurableOutbox } from './outbox.ts';
import { reachablePairingHost, type PairingBridge } from './pairing.ts';

export interface SessionRuntime extends PairingBridge {
  start(): Promise<void>;
  shutdown(): Promise<void>;
  status(): any;
  event(name: string, event: any, ctx: ExtensionContext): Promise<any>;
}
type Options = { profileRoot?: string; ensureDaemon?: () => Promise<DaemonConnection>; reconnectBaseMs?: number };

export async function createBridgeRuntime(pi: ExtensionAPI, ctx: ExtensionContext, options: Options = {}): Promise<SessionRuntime> {
  const root = options.profileRoot ?? defaultProfileRoot;
  const processIdentity = resolveProcessIdentity({ profileRoot: root });
  const identity = beginSessionIdentity(processIdentity, ctx.sessionManager.getSessionId());
  const generation = identity.generation;
  const config = loadBridgeConfig(root);
  const outbox = new DurableOutbox({ path: join(root, `spool-${identity.processInstanceId}.json`), processId: identity.processId, processInstanceId: identity.processInstanceId });
  const pause = new PauseController();
  let socket: WebSocket | undefined;
  let connection: DaemonConnection | undefined;
  let connected = false, closed = false, reconnectAttempt = 0;
  let reconnectTimer: NodeJS.Timeout | undefined, heartbeat: NodeJS.Timeout | undefined;
  const isCurrent = () => !closed && processIdentity.generation === generation;
  const send = (value: Record<string, unknown>) => { if (socket?.readyState === WebSocket.OPEN) socket.send(JSON.stringify(value)); };
  const gates = new GateController({ targetProcessId: identity.processId, sessionId: identity.sessionId, getTool: name => pi.getAllTools().find(tool => tool.name === name), send, audit: record => outbox.observe({ type: 'status', code: 'tool_gate_audit', message: JSON.stringify(record).slice(0, 2048) }, { mandatory: true }), isCurrent });
  const controls = createControlHandler({ pi, ctx, processId: identity.processId, sessionId: identity.sessionId, generation, isCurrent, send, onAbort: () => gates.abort(), buildContent: buildUserContent });

  function clearConnectionWork(): void { if (heartbeat) clearInterval(heartbeat); heartbeat = undefined; }
  function scheduleReconnect(): void {
    if (closed || reconnectTimer) return;
    connected = false; clearConnectionWork(); gates.daemonDisconnected(); pause.daemonDisconnected();
    const cap = Math.min(30_000, (options.reconnectBaseMs ?? 250) * 2 ** Math.min(reconnectAttempt++, 8));
    const delay = Math.max(1, Math.round(cap * (0.75 + Math.random() * 0.5)));
    reconnectTimer = setTimeout(() => { reconnectTimer = undefined; void connect(); }, delay);
    reconnectTimer.unref?.();
  }
  function flush(): void { if (!connected || socket?.readyState !== WebSocket.OPEN) return; for (const frame of outbox.assign()) send(frame); }
  async function connect(): Promise<void> {
    if (closed || !config.enabled) return;
    try {
      connection = await (options.ensureDaemon ?? (() => ensureLocalDaemon({ profileRoot: root })))();
      if (closed) return;
      const host = connection.endpoint.host === '0.0.0.0' || connection.endpoint.host === '::' ? '127.0.0.1' : connection.endpoint.host;
      const ws = new WebSocket(`ws://${host}:${connection.endpoint.port}/control`, { headers: { authorization: `Bearer ${connection.adminToken}` }, perMessageDeflate: false });
      socket = ws;
      ws.on('open', () => send({ protocolVersion: 3, type: 'hello', role: 'bridge', supportedVersions: [3], capabilities: ['commands.prompt','commands.abort','commands.model','commands.thinking','commands.compact','events.replay'] }));
      ws.on('message', data => {
        let value: any; try { value = JSON.parse(String(data)); } catch { ws.close(1002, 'invalid message'); return; }
        if (value.type === 'welcome') {
          send({ protocolVersion: 3, type: 'process.register', hostId: identity.hostId, processId: identity.processId, processInstanceId: identity.processInstanceId, sessionId: identity.sessionId, ...(identity.parentProcessId ? { parentProcessId: identity.parentProcessId } : {}), runId: identity.runId, metadata: { mode: ctx.mode, cwd: config.pathPolicy === 'full' ? ctx.cwd.slice(0, 1024) : config.pathPolicy === 'basename' ? (ctx.cwd.split(/[\\/]/).pop() ?? '').slice(0, 1024) : '', extensionVersion: '0.2.0' }, capabilities: ['prompt','steer','follow_up','abort','model','thinking','compact'], heartbeatIntervalMs: 10_000, nextProcessSequence: (outbox.assign().at(-1)?.processSequence ?? 0) + 1 });
          return;
        }
        if (value.type === 'process.registered') {
          try { outbox.resumeFrom(value.resumeFromProcessSequence); } catch { ws.close(1011, 'resume conflict'); return; }
          connected = true; reconnectAttempt = 0;
          heartbeat = setInterval(() => send({ protocolVersion: 3, type: 'heartbeat', processId: identity.processId, processInstanceId: identity.processInstanceId, sentAt: new Date().toISOString() }), 10_000);
          heartbeat.unref?.(); flush(); return;
        }
        if (value.type === 'event.ack') { outbox.acknowledge(value.expectedNextProcessSequence - 1); return; }
        if (value.type === 'command.request') { void controls(value); return; }
        if (value.type === 'tool_gate.policy') { if (value.targetProcessId === identity.processId && value.sessionId === identity.sessionId) try { gates.arm(value); send({ protocolVersion: 3, type: 'dashboard.lease.state', leaseId: value.leaseId, targetProcessId: identity.processId, sessionId: identity.sessionId, state: 'gateArmed' }); } catch { /* closed/stale bridge remains inert */ } return; }
        if (value.type === 'tool_gate.decision') { if (value.targetProcessId === identity.processId && value.sessionId === identity.sessionId) gates.decide(value); return; }
        if (value.type === 'pause.arm') { const deadline = Date.parse(value.deadline); if (value.targetProcessId === identity.processId && value.sessionId === identity.sessionId && Number.isFinite(deadline)) try { pause.arm({ generation, leaseId: value.leaseId, deadline, disconnectMode: value.disconnectMode }); send({ protocolVersion: 3, type: 'dashboard.lease.state', leaseId: value.leaseId, targetProcessId: identity.processId, sessionId: identity.sessionId, state: 'pauseArmed' }); } catch { /* invalid/expired pause remains inert */ } return; }
        if (value.type === 'pause.resume') { if (value.targetProcessId === identity.processId && value.sessionId === identity.sessionId) { pause.resume(generation, value.leaseId); send({ protocolVersion: 3, type: 'dashboard.lease.state', leaseId: value.leaseId, targetProcessId: identity.processId, sessionId: identity.sessionId, state: 'resumed' }); } return; }
        if (value.type === 'dashboard.disconnected') { gates.disconnectLease(value.leaseId); pause.disconnectLease(value.leaseId); }
      });
      ws.on('close', scheduleReconnect);
      ws.on('error', () => { /* close drives redacted reconnect state */ });
    } catch { scheduleReconnect(); }
  }

  return {
    async start() { if (closed) return; outbox.observe({ type: 'session_start', sessionId: identity.sessionId }, { mandatory: true }); outbox.observe({ type: 'process_state', state: publicProcessState(ctx, { pathPolicy: config.pathPolicy }) }, { mandatory: true, snapshot: true }); await connect(); },
    async event(name, event, eventCtx) {
      if (!isCurrent()) return;
      if (name === 'context') return pause.boundary('context', generation);
      if (name === 'tool_call') { await pause.boundary('tool_call', generation); return gates.gate(event); }
      const mapped = mapPiEvent(name, event, eventCtx, { runId: identity.runId, sessionId: identity.sessionId });
      if (mapped) { const delta = mapped.type === 'assistant_delta' || mapped.type === 'thinking_delta'; outbox.observe(mapped, delta ? { coalesceKey: mapped.type } : { mandatory: /(?:_start|_end|settled)$/.test(mapped.type) }); flush(); }
    },
    async shutdown() { if (closed) return; outbox.observe({ type: 'session_shutdown', sessionId: identity.sessionId }, { mandatory: true }); flush(); closed = true; pause.shutdown(); gates.shutdown(); if (reconnectTimer) clearTimeout(reconnectTimer); clearConnectionWork(); await new Promise(resolve => setTimeout(resolve, 20)); socket?.close(1000, 'session shutdown'); connected = false; },
    status: () => ({ enabled: config.enabled, connected, host: connection?.endpoint.host ?? config.host, port: connection?.endpoint.port ?? config.port, clients: 0, maxClients: config.maxClients, processId: identity.processId, processInstanceId: identity.processInstanceId }),
    async issuePairing() { if (!connection) throw new Error('daemon_unavailable'); return daemonAdminRequest(connection, 'pair', identity.processId, reachablePairingHost(connection.endpoint.host)); },
    async rotateToken() { if (!connection) throw new Error('daemon_unavailable'); await daemonAdminRequest(connection, 'rotate'); },
    async setEnabled(enabled) { writeEnabled(enabled, root); if (!connection) throw new Error('daemon_unavailable'); await daemonAdminRequest(connection, enabled ? 'enable' : 'disable'); if (!enabled) socket?.close(1000, 'disabled'); },
    async ensureConnected() { if (!connected) await connect(); },
  };
}
