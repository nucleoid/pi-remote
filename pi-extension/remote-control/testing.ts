export function createFakePi() {
  const handlers = new Map<string, Array<(event: any, ctx: any) => unknown>>();
  const commands = new Map<string, any>();
  const api: any = {
    handlers,
    commands,
    on(name: string, handler: (event: any, ctx: any) => unknown) {
      const list = handlers.get(name) ?? [];
      list.push(handler);
      handlers.set(name, list);
    },
    registerCommand(name: string, command: any) { commands.set(name, command); },
    async emit(name: string, event: any = {}, ctx: any = createFakeContext()) {
      const results = [];
      for (const handler of handlers.get(name) ?? []) results.push(await handler(event, ctx));
      return results;
    },
    sendUserMessage() {}, setModel() {}, setThinkingLevel() {}, getAllTools() { return []; },
  };
  return api;
}

export function createFakeContext(overrides: Record<string, unknown> = {}) {
  const notifications: string[] = [];
  return {
    mode: 'tui', cwd: '/safe/project', notifications,
    ui: {
      notify(message: string) { notifications.push(message); },
      setStatus() {},
    },
    sessionManager: {
      getSessionId: () => '11111111-1111-4111-8111-111111111111',
      getSessionFile: () => '/safe/session.jsonl',
      buildSessionContext: () => ({ messages: [] }),
    },
    isIdle: () => true,
    hasPendingMessages: () => false,
    abort: async () => {},
    compact: (_options: any) => {},
    modelRegistry: { find: () => undefined },
    ...overrides,
  } as any;
}

export async function flushTasks() {
  await new Promise(resolve => setTimeout(resolve, 10));
}
