declare module "@earendil-works/pi-coding-agent" {
  export interface ExtensionContext {
    cwd?: string;
    mode?: string;
    model?: { provider?: string; id?: string; name?: string };
    ui: {
      setStatus(name: string, value: string | undefined): void;
      notify(message: string, level?: "info" | "warning" | "error"): void;
    };
    isIdle?(): boolean;
    hasPendingMessages?(): boolean;
    abort?(): Promise<void> | void;
    sessionManager?: {
      buildSessionContext?(): { messages?: unknown[] };
      getSessionFile?(): string | undefined;
      getLeafId?(): string | undefined;
    };
  }

  export interface ExtensionAPI {
    on(event: string, handler: (event: any, ctx: ExtensionContext) => unknown): void;
    sendUserMessage(content: unknown, options?: { deliverAs?: "steer" | "followUp" }): void;
    registerCommand(name: string, command: { description: string; handler: (args: unknown, ctx: ExtensionContext) => unknown }): void;
  }
}
