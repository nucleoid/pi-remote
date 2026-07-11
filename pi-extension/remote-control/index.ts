import type { ExtensionAPI, ExtensionContext } from '@earendil-works/pi-coding-agent';
import { createBridgeRuntime, type SessionRuntime } from './bridge.ts';
import { PUBLIC_PI_HOOKS } from './events.ts';
import { registerPairingCommands, type PairingBridge } from './pairing.ts';

export type RemoteControlDependencies = {
  createRuntime?: (pi: ExtensionAPI, ctx: ExtensionContext) => Promise<SessionRuntime> | SessionRuntime;
};

function reportFailure(ctx: ExtensionContext) {
  try {
    ctx.ui?.setStatus?.('remote', 'remote unavailable');
    ctx.ui?.notify?.('Remote control bridge is unavailable. Pi will continue normally.', 'warning');
  } catch { /* UI reporting must never affect Pi. */ }
}

export function createRemoteControl(dependencies: RemoteControlDependencies = {}) {
  const makeRuntime = dependencies.createRuntime ?? createBridgeRuntime;
  return function install(pi: ExtensionAPI): void {
    let generation = 0;
    let active: { generation: number; runtime: Promise<SessionRuntime> } | undefined;
    let activeValue: SessionRuntime | undefined;
    registerPairingCommands(pi, { getBridge: () => activeValue as (SessionRuntime & PairingBridge) | undefined });

    pi.on('session_start', async (_event, ctx) => {
      if (ctx.mode !== 'tui' && ctx.mode !== 'rpc') return;
      if (active) return;
      const current = ++generation;
      const runtime = Promise.resolve().then(() => makeRuntime(pi, ctx));
      active = { generation: current, runtime };
      try {
        const value = await runtime;
        if (active?.generation === current) activeValue = value;
        await value.start();
      } catch {
        reportFailure(ctx);
      }
    });

    pi.on('session_shutdown', async (_event, ctx) => {
      const previous = active;
      active = undefined;
      activeValue = undefined;
      generation++;
      if (!previous) return;
      try {
        const runtime = await previous.runtime;
        await runtime.shutdown();
      } catch {
        reportFailure(ctx);
      } finally {
        try { ctx.ui?.setStatus?.('remote', undefined); } catch { /* noop */ }
      }
    });

    for (const hook of PUBLIC_PI_HOOKS) {
      (pi.on as any)(hook, async (event: unknown, ctx: ExtensionContext) => {
        const current = active;
        if (!current || current.generation !== generation) return;
        try { return await (await current.runtime).event?.(hook, event, ctx); } catch { reportFailure(ctx); return undefined; }
      });
    }
  };
}

export default createRemoteControl();
