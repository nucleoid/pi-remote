import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import type { IncomingMessage } from "node:http";
import { existsSync, mkdirSync, readFileSync, writeFileSync, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, hostname, networkInterfaces } from "node:os";
import { randomBytes } from "node:crypto";
import { execFile } from "node:child_process";
import qrcode from "qrcode-terminal";

interface RemoteConfig {
  enabled: boolean;
  host: string;
  port: number;
  token: string;
  allowNoAuthFromLoopback: boolean;
  maxClients: number;
  failedAuthLimit: number;
  failedAuthWindowMs: number;
}

interface RemoteWebSocket extends WebSocket {
  piRemoteAuthenticated?: boolean;
  piRemoteRevoked?: boolean;
}

const CONFIG_DIR = join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(CONFIG_DIR, "remote-control.json");

const DEFAULT_CONFIG: Omit<RemoteConfig, "token"> = {
  enabled: true,
  host: "127.0.0.1",
  port: 37891,
  allowNoAuthFromLoopback: false,
  maxClients: 3,
  failedAuthLimit: 8,
  failedAuthWindowMs: 60_000,
};

let wss: WebSocketServer | undefined;
let latestCtx: ExtensionContext | undefined;
let currentConfig: RemoteConfig | undefined;
let currentPort: number | undefined;
let started = false;

function loadConfig(): RemoteConfig {
  mkdirSync(CONFIG_DIR, { recursive: true });

  if (!existsSync(CONFIG_PATH)) {
    const config: RemoteConfig = {
      ...DEFAULT_CONFIG,
      token: randomBytes(24).toString("base64url"),
    };
    writeConfig(config);
    return config;
  }

  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const config: RemoteConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    token: parsed.token || randomBytes(24).toString("base64url"),
  };

  // Persist migrations/defaulted fields.
  writeConfig(config);
  return config;
}

function writeConfig(config: RemoteConfig) {
  mkdirSync(CONFIG_DIR, { recursive: true, mode: 0o700 });
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", { encoding: "utf8", mode: 0o600 });
  try {
    chmodSync(CONFIG_DIR, 0o700);
    chmodSync(CONFIG_PATH, 0o600);
  } catch {
    // Best-effort on filesystems/platforms that do not support POSIX modes.
  }
}

function send(ws: WebSocket, message: unknown) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(message));
  }
}

function broadcast(message: unknown) {
  if (!wss) return;
  const payload = JSON.stringify(message);
  for (const client of wss.clients) {
    if (client.readyState === WebSocket.OPEN) client.send(payload);
  }
}

function getLanAddress(): string | undefined {
  const interfaces = networkInterfaces();
  const candidates: Array<{ name: string; address: string; cidr?: string }> = [];
  for (const [name, entries] of Object.entries(interfaces)) {
    for (const entry of entries ?? []) {
      if (entry.family === "IPv4" && !entry.internal) candidates.push({ name, address: entry.address, cidr: entry.cidr ?? undefined });
    }
  }

  const physical = candidates.find((c) =>
    /wi-?fi|wlan|ethernet/i.test(c.name) &&
    !/vethernet|virtual|wsl|hyper-v|loopback/i.test(c.name) &&
    !c.cidr?.endsWith("/32"),
  );
  if (physical) return physical.address;

  const nonVirtual = candidates.find((c) => !/vethernet|virtual|wsl|hyper-v|loopback/i.test(c.name) && !c.cidr?.endsWith("/32"));
  if (nonVirtual) return nonVirtual.address;

  return candidates.find((c) => !c.cidr?.endsWith("/32"))?.address ?? candidates[0]?.address;
}

function connectionHost(config: RemoteConfig): string {
  if (config.host === "0.0.0.0") return getLanAddress() ?? hostname();
  return config.host;
}

function webSocketUrl(config: RemoteConfig): string {
  const host = connectionHost(config);
  return `ws://${host}:${currentPort ?? config.port}?token=${encodeURIComponent(config.token)}`;
}

function deepLinkUrl(config: RemoteConfig): string {
  const host = connectionHost(config);
  return `pi-remote://${host}:${currentPort ?? config.port}?token=${encodeURIComponent(config.token)}`;
}

function redactedWebSocketUrl(host: string, port: number): string {
  return `ws://${host}:${port}?token=[redacted]`;
}

function redactedDeepLinkUrl(host: string, port: number): string {
  return `pi-remote://${host}:${port}?token=[redacted]`;
}

export function redactedStatusLines(config: RemoteConfig, host = connectionHost(config), port = currentPort ?? config.port, configPath = CONFIG_PATH): string[] {
  const lines = [
    `Remote control: ${config.enabled ? "enabled" : "disabled"}`,
    `WebSocket: ${redactedWebSocketUrl(host, port)}`,
    `Android deep link: ${redactedDeepLinkUrl(host, port)}`,
    `Authenticated clients: ${wss ? authenticatedClientCount(wss.clients) : 0}/${config.maxClients}`,
    `Failed-auth limit: ${config.failedAuthLimit} per ${Math.round(config.failedAuthWindowMs / 1000)}s per remote address`,
    `Loopback no-auth bypass: ${config.allowNoAuthFromLoopback ? "ENABLED (unsafe; loopback only)" : "disabled"}`,
    `Pairing QR/deep link: run /remote-control-qr or /remote-control-android`,
    `Config: ${configPath}`,
    `For Android over LAN/Tailscale, set host to "0.0.0.0" and restart or /reload.`,
  ];
  if (config.allowNoAuthFromLoopback) lines.splice(1, 0, "WARNING: loopback no-auth bypass is enabled for local clients only.");
  return lines;
}

export function pairingWarningLines(secretMaterial: string): string[] {
  return [
    "WARNING: Secret pairing material follows. Anyone who can see this QR/deep link/token can control this Pi session until you rotate the token.",
    "Do not paste it into public issues, logs, screenshots, or chat.",
    secretMaterial,
  ];
}

function findAdb(): string {
  const candidates = [
    process.env.ADB,
    process.env.ANDROID_HOME ? join(process.env.ANDROID_HOME, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : undefined,
    process.env.ANDROID_SDK_ROOT ? join(process.env.ANDROID_SDK_ROOT, "platform-tools", process.platform === "win32" ? "adb.exe" : "adb") : undefined,
    join(homedir(), "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe"),
    "adb",
  ].filter(Boolean) as string[];
  return candidates.find((candidate) => existsSync(candidate) || candidate === "adb") ?? "adb";
}

function makeQr(text: string): string {
  let output = "";
  qrcode.generate(text, { small: true }, (qr: string) => {
    output = qr;
  });
  return output;
}

function runAdb(args: string[]): Promise<{ stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    execFile(findAdb(), args, { windowsHide: true }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${error.message}\n${stderr}`.trim()));
        return;
      }
      resolve({ stdout, stderr });
    });
  });
}

function recentMessages(limit = 50) {
  try {
    const messages = latestCtx?.sessionManager?.buildSessionContext?.()?.messages ?? [];
    return messages
      .filter((message: any) => message?.role === "user" || message?.role === "assistant")
      .slice(-limit);
  } catch {
    return [];
  }
}

function publicState() {
  const ctx = latestCtx;
  return {
    cwd: ctx?.cwd,
    isIdle: ctx?.isIdle?.() ?? true,
    hasPendingMessages: ctx?.hasPendingMessages?.() ?? false,
    sessionFile: ctx?.sessionManager?.getSessionFile?.(),
    leafId: ctx?.sessionManager?.getLeafId?.(),
    model: ctx?.model ? { provider: ctx.model.provider, id: ctx.model.id, name: ctx.model.name } : undefined,
  };
}

function remoteAddressOf(req: IncomingMessage): string {
  return req.socket?.remoteAddress ?? "unknown";
}

function isLoopbackAddress(remoteAddress: string): boolean {
  return remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
}

export function createAuthLimiter(limit: number, windowMs: number) {
  const attempts = new Map<string, { count: number; resetAt: number }>();
  return {
    recordFailure(remoteAddress: string, now = Date.now()): boolean {
      const current = attempts.get(remoteAddress);
      if (!current || current.resetAt <= now) {
        attempts.set(remoteAddress, { count: 1, resetAt: now + windowMs });
        return false;
      }
      current.count += 1;
      return current.count >= limit;
    },
    isLimited(remoteAddress: string, now = Date.now()): boolean {
      const current = attempts.get(remoteAddress);
      return !!current && current.resetAt > now && current.count >= limit;
    },
    clear(remoteAddress: string) {
      attempts.delete(remoteAddress);
    },
  };
}

type AuthLimiter = ReturnType<typeof createAuthLimiter>;

let authLimiter: AuthLimiter | undefined;

export function authenticateRequest(req: Pick<IncomingMessage, "url" | "headers" | "socket">, config: RemoteConfig, limiter: AuthLimiter): { ok: boolean; reason?: "unauthorized" | "rate_limited" } {
  const remoteAddress = req.socket?.remoteAddress ?? "unknown";
  if (limiter.isLimited(remoteAddress)) return { ok: false, reason: "rate_limited" };

  let url: URL;
  try {
    url = new URL(req.url ?? "/", "http://localhost");
  } catch {
    const limited = limiter.recordFailure(remoteAddress);
    return { ok: false, reason: limited ? "rate_limited" : "unauthorized" };
  }
  const queryToken = url.searchParams.get("token");
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;

  if (config.allowNoAuthFromLoopback && isLoopbackAddress(remoteAddress)) {
    limiter.clear(remoteAddress);
    return { ok: true };
  }
  if (queryToken === config.token || bearer === config.token) {
    limiter.clear(remoteAddress);
    return { ok: true };
  }

  const limited = limiter.recordFailure(remoteAddress);
  return { ok: false, reason: limited ? "rate_limited" : "unauthorized" };
}

export function authenticatedClientCount(clients: Iterable<WebSocket | RemoteWebSocket>): number {
  let count = 0;
  for (const client of clients) {
    if (client.readyState === WebSocket.OPEN && (client as RemoteWebSocket).piRemoteAuthenticated) count += 1;
  }
  return count;
}

const MAX_BINARY_ATTACHMENT_BYTES = 5 * 1024 * 1024;
const MAX_TEXT_ATTACHMENT_BYTES = 200 * 1024;
const MAX_ATTACHMENTS = 4;
export const REMOTE_CONTROL_MAX_PAYLOAD = 32 * 1024 * 1024;

function cleanAttachmentName(name: unknown): string {
  if (typeof name !== "string" || !name.trim()) throw new Error("Attachment name is required");
  return name.trim().replace(/[\r\n]/g, " ").slice(0, 240);
}

function cleanMimeType(mimeType: unknown, fallback = "application/octet-stream"): string {
  if (typeof mimeType !== "string" || !mimeType.trim()) return fallback;
  const clean = mimeType.trim().toLowerCase();
  if (!/^[a-z0-9!#$&^_.+-]+\/[a-z0-9!#$&^_.+-]+$/i.test(clean)) throw new Error("Invalid attachment MIME type");
  return clean;
}

function decodedBase64Length(data: string): number {
  const padding = data.endsWith("==") ? 2 : data.endsWith("=") ? 1 : 0;
  return (data.length / 4) * 3 - padding;
}

function isSupportedImageBytes(mimeType: string, bytes: Buffer): boolean {
  if (mimeType === "image/png") return bytes.length >= 8 && bytes[0] === 0x89 && bytes[1] === 0x50 && bytes[2] === 0x4e && bytes[3] === 0x47 && bytes[4] === 0x0d && bytes[5] === 0x0a && bytes[6] === 0x1a && bytes[7] === 0x0a;
  if (mimeType === "image/jpeg" || mimeType === "image/jpg") return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  if (mimeType === "image/gif") return bytes.length >= 6 && (bytes.subarray(0, 6).toString("ascii") === "GIF87a" || bytes.subarray(0, 6).toString("ascii") === "GIF89a");
  if (mimeType === "image/webp") return bytes.length >= 12 && bytes.subarray(0, 4).toString("ascii") === "RIFF" && bytes.subarray(8, 12).toString("ascii") === "WEBP";
  return false;
}

function decodeBase64Attachment(name: string, data: unknown): Buffer {
  if (typeof data !== "string" || !data.trim() || !/^[A-Za-z0-9+/]*={0,2}$/.test(data) || data.length % 4 !== 0) {
    throw new Error(`Invalid base64 attachment: ${name}`);
  }
  if (decodedBase64Length(data) > MAX_BINARY_ATTACHMENT_BYTES) throw new Error(`Attachment ${name} exceeds 5MB`);
  const bytes = Buffer.from(data, "base64");
  if (bytes.toString("base64") !== data.replace(/=+$/, "") + "=".repeat((4 - (data.replace(/=+$/, "").length % 4)) % 4)) {
    throw new Error(`Invalid base64 attachment: ${name}`);
  }
  return bytes;
}

export function remoteHello(state: unknown) {
  return {
    type: "hello",
    server: "pi-remote-control",
    protocolVersion: 2,
    capabilities: { binaryFileAttachments: true },
    state,
  };
}

export function buildUserContent(text: string, images?: any[], files?: any[]) {
  const content: any[] = [];
  if (text) content.push({ type: "text", text });
  if ((images?.length ?? 0) + (files?.length ?? 0) > MAX_ATTACHMENTS) throw new Error(`At most ${MAX_ATTACHMENTS} attachments are supported`);
  for (const file of files ?? []) {
    if (!file?.name) continue;
    const name = cleanAttachmentName(file.name);
    const mimeType = cleanMimeType(file.mimeType, file.encoding === "base64" ? "application/octet-stream" : "text/plain");
    if (file.encoding === "base64" || file.data) {
      if (file.encoding !== "base64") throw new Error(`Binary attachment ${name} must declare encoding: base64`);
      const bytes = decodeBase64Attachment(name, file.data);
      content.push({
        type: "text",
        text: `Attached binary file: ${name} (${mimeType}, ${bytes.length} B). The file was received as an attachment; binary bytes are intentionally not inlined.`,
      });
      continue;
    }
    if (typeof file.text !== "string") continue;
    if (Buffer.byteLength(file.text, "utf8") > MAX_TEXT_ATTACHMENT_BYTES) throw new Error(`Text attachment ${name} exceeds 200KB`);
    content.push({
      type: "text",
      text: `Attached file: ${name} (${mimeType})\n\n\`\`\`\n${file.text}\n\`\`\``,
    });
  }
  for (const image of images ?? []) {
    if (!image?.data || !image?.mimeType) continue;
    const name = cleanAttachmentName(image.name ?? "image");
    const mimeType = cleanMimeType(image.mimeType);
    if (!mimeType.startsWith("image/")) throw new Error(`Invalid image attachment: ${name}`);
    const data = decodeBase64Attachment(name, image.data);
    if (!isSupportedImageBytes(mimeType, data)) throw new Error(`Invalid image attachment: ${name}`);
    content.push({
      type: "image",
      data: data.toString("base64"),
      mimeType,
    });
  }
  return content.length === 1 && content[0].type === "text" ? content[0].text : content;
}

async function handleCommand(ws: WebSocket, raw: any) {
  const id = raw?.id;
  try {
    if (!raw || typeof raw !== "object") throw new Error("Command must be a JSON object");
    if (typeof raw.type !== "string") throw new Error("Command type is required");

    switch (raw.type) {
      case "ping":
        send(ws, { type: "response", id, success: true, data: { pong: true, state: publicState() } });
        return;

      case "get_state":
        send(ws, { type: "response", id, success: true, data: publicState() });
        return;

      case "get_history":
        send(ws, { type: "history", id, messages: recentMessages(typeof raw.limit === "number" ? raw.limit : 50), state: publicState() });
        return;

      case "prompt": {
        if (typeof raw.text !== "string") throw new Error("prompt.text must be a string");
        const content = buildUserContent(raw.text, raw.images, raw.files);
        if (latestCtx?.isIdle?.()) {
          piApi!.sendUserMessage(content);
        } else {
          const deliverAs = raw.deliverAs === "followUp" ? "followUp" : "steer";
          piApi!.sendUserMessage(content, { deliverAs });
        }
        send(ws, { type: "response", id, success: true });
        return;
      }

      case "steer": {
        if (typeof raw.text !== "string") throw new Error("steer.text must be a string");
        piApi!.sendUserMessage(buildUserContent(raw.text, raw.images, raw.files), { deliverAs: "steer" });
        send(ws, { type: "response", id, success: true });
        return;
      }

      case "follow_up":
      case "followUp": {
        if (typeof raw.text !== "string") throw new Error("follow_up.text must be a string");
        piApi!.sendUserMessage(buildUserContent(raw.text, raw.images, raw.files), { deliverAs: "followUp" });
        send(ws, { type: "response", id, success: true });
        return;
      }

      case "abort":
        await latestCtx?.abort?.();
        send(ws, { type: "response", id, success: true });
        return;

      default:
        throw new Error(`Unknown command type: ${raw.type}`);
    }
  } catch (error: any) {
    send(ws, { type: "response", id, success: false, error: error?.message ?? String(error) });
  }
}

let piApi: ExtensionAPI | undefined;

function attachServerHandlers(server: WebSocketServer, config: RemoteConfig, ctx: ExtensionContext) {
  authLimiter = createAuthLimiter(config.failedAuthLimit, config.failedAuthWindowMs);
  server.on("connection", (ws: RemoteWebSocket, req) => {
    const liveConfig = currentConfig ?? config;
    let auth: ReturnType<typeof authenticateRequest>;
    try {
      auth = authenticateRequest(req, liveConfig, authLimiter!);
    } catch {
      auth = { ok: false, reason: "unauthorized" };
    }
    if (!auth.ok) {
      ctx.ui.notify(`Rejected remote-control connection from ${remoteAddressOf(req)}: ${auth.reason === "rate_limited" ? "rate limited" : "unauthorized"}. Token value was not logged.`, auth.reason === "rate_limited" ? "warning" : "info");
      send(ws, { type: "error", error: auth.reason });
      ws.close(1008, auth.reason);
      return;
    }

    if (authenticatedClientCount(server.clients) >= liveConfig.maxClients) {
      ctx.ui.notify(`Rejected remote-control connection from ${remoteAddressOf(req)}: max authenticated clients reached.`, "warning");
      send(ws, { type: "error", error: "too_many_clients" });
      ws.close(1013, "too_many_clients");
      return;
    }

    ws.piRemoteAuthenticated = true;
    send(ws, remoteHello(publicState()));
    send(ws, { type: "history", messages: recentMessages(50), state: publicState() });
    broadcast({ type: "client_count", count: authenticatedClientCount(server.clients) });

    ws.on("message", (data) => {
      if (ws.piRemoteRevoked) {
        ws.terminate();
        return;
      }
      try {
        handleCommand(ws, JSON.parse(data.toString("utf8")));
      } catch (error: any) {
        send(ws, { type: "response", success: false, error: `Invalid JSON: ${error?.message ?? String(error)}` });
      }
    });

    ws.on("close", () => broadcast({ type: "client_count", count: wss ? authenticatedClientCount(wss.clients) : 0 }));
  });
}

function announceListening(ctx: ExtensionContext, config: RemoteConfig) {
  const host = connectionHost(config);
  const lanHint = `${host}:${currentPort ?? config.port}`;
  ctx.ui.setStatus("remote", `remote ${lanHint}`);
  ctx.ui.notify(redactedStatusLines(config, host, currentPort ?? config.port).join("\n"), config.allowNoAuthFromLoopback ? "warning" : "info");
}

function startServer(ctx: ExtensionContext) {
  if (started) return;

  currentConfig = loadConfig();
  const config = currentConfig;
  if (!config.enabled || ctx.mode !== "tui") {
    started = false;
    ctx.ui.setStatus("remote", undefined);
    return;
  }
  started = true;

  const tryPort = (port: number, attemptsLeft: number) => {
    const server = new WebSocketServer({ host: config.host, port, maxPayload: REMOTE_CONTROL_MAX_PAYLOAD });
    let settled = false;

    server.once("listening", () => {
      settled = true;
      wss = server;
      currentPort = port;
      attachServerHandlers(server, config, ctx);
      announceListening(ctx, config);
    });

    server.once("error", (error: any) => {
      if (!settled && error?.code === "EADDRINUSE" && attemptsLeft > 0) {
        server.close();
        tryPort(port + 1, attemptsLeft - 1);
        return;
      }
      started = false;
      ctx.ui.setStatus("remote", "remote error");
      ctx.ui.notify(`Remote control server error: ${error.message}`, "error");
    });
  };

  tryPort(config.port, 20);
}

function stopServer(ctx?: ExtensionContext) {
  started = false;
  ctx?.ui.setStatus("remote", undefined);
  if (!wss) return;
  const server = wss;
  wss = undefined;
  for (const client of server.clients) client.close(1001, "pi session shutdown");
  server.close();
}

export default function remoteControl(pi: ExtensionAPI) {
  piApi = pi;

  pi.on("session_start", async (_event, ctx) => {
    latestCtx = ctx;
    startServer(ctx);
    broadcast({ type: "session_start", state: publicState() });
  });

  pi.on("session_shutdown", async (_event, ctx) => {
    broadcast({ type: "session_shutdown" });
    stopServer(ctx);
    latestCtx = undefined;
  });

  pi.on("agent_start", async () => broadcast({ type: "agent_start", state: publicState() }));
  pi.on("agent_end", async (event) => broadcast({ type: "agent_end", messages: event.messages, state: publicState() }));
  pi.on("queue_update", async (event) => broadcast({ type: "queue_update", steering: event.steering, followUp: event.followUp }));

  pi.on("message_update", async (event) => {
    const update = event.assistantMessageEvent;
    if (update?.type === "text_delta") {
      broadcast({ type: "assistant_delta", text: update.delta });
    } else if (update?.type === "thinking_delta") {
      broadcast({ type: "thinking_delta", text: update.delta });
    } else if (update?.type === "toolcall_end") {
      broadcast({ type: "tool_call", toolCall: update.toolCall });
    }
  });

  pi.on("message_end", async (event) => {
    if (event.message?.role === "assistant") {
      broadcast({ type: "assistant_message", message: event.message });
    } else if (event.message?.role === "user") {
      broadcast({ type: "user_message", message: event.message });
    }
  });

  pi.on("tool_execution_start", async (event) => {
    broadcast({ type: "tool_start", toolCallId: event.toolCallId, toolName: event.toolName, args: event.args });
  });

  pi.on("tool_execution_update", async (event) => {
    broadcast({ type: "tool_update", toolCallId: event.toolCallId, toolName: event.toolName, partialResult: event.partialResult });
  });

  pi.on("tool_execution_end", async (event) => {
    broadcast({ type: "tool_end", toolCallId: event.toolCallId, toolName: event.toolName, result: event.result, isError: event.isError });
  });

  pi.registerCommand("remote-control", {
    description: "Show remote-control WebSocket connection info",
    handler: async (_args, ctx) => {
      const config = currentConfig ?? loadConfig();
      ctx.ui.notify(redactedStatusLines(config).join("\n"), config.allowNoAuthFromLoopback ? "warning" : "info");
    },
  });

  pi.registerCommand("remote-control-qr", {
    description: "Show a QR code for connecting the Android Pi Remote app",
    handler: async (_args, ctx) => {
      const config = currentConfig ?? loadConfig();
      const link = deepLinkUrl(config);
      const qr = makeQr(link);
      ctx.ui.notify(
        [
          ...pairingWarningLines("Scan with your phone camera to open Pi Remote:"),
          "",
          qr,
          "",
          link,
        ].join("\n"),
        "warning",
      );
    },
  });

  pi.registerCommand("remote-control-android", {
    description: "Open Pi Remote on an attached Android device via adb",
    handler: async (_args, ctx) => {
      const config = currentConfig ?? loadConfig();
      const link = deepLinkUrl(config);
      try {
        const devices = await runAdb(["devices"]);
        if (!/\tdevice\b/.test(devices.stdout)) {
          ctx.ui.notify(`No authorized Android device found.\n\n${devices.stdout.trim() || devices.stderr.trim()}`, "warning");
          return;
        }
        await runAdb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", link, "com.pragmaticcoder.piremote"]);
        ctx.ui.notify(pairingWarningLines(`Opened Pi Remote on Android.\n${link}`).join("\n"), "warning");
      } catch (error: any) {
        ctx.ui.notify(pairingWarningLines(`Failed to open Android app via adb:\n${error?.message ?? String(error)}\n\nDeep link:\n${link}`).join("\n"), "error");
      }
    },
  });

  pi.registerCommand("remote-control-rotate-token", {
    description: "Rotate the Pi Remote auth token and disconnect existing clients",
    handler: async (_args, ctx) => {
      const config = { ...(currentConfig ?? loadConfig()), token: randomBytes(24).toString("base64url") };
      writeConfig(config);
      currentConfig = config;
      if (wss) {
        for (const client of wss.clients as Set<RemoteWebSocket>) {
          client.piRemoteRevoked = true;
          client.close(1008, "token rotated");
          client.terminate();
        }
      }
      ctx.ui.notify(["Remote-control token rotated. Existing Android clients must be paired again.", ...redactedStatusLines(config)].join("\n"), "warning");
    },
  });

  pi.registerCommand("remote-control-disable", {
    description: "Disable Pi Remote and stop the current server",
    handler: async (_args, ctx) => {
      const config = { ...(currentConfig ?? loadConfig()), enabled: false };
      writeConfig(config);
      currentConfig = config;
      stopServer(ctx);
      ctx.ui.notify("Remote control disabled. Run /remote-control-enable to re-enable it.", "warning");
    },
  });

  pi.registerCommand("remote-control-enable", {
    description: "Enable Pi Remote for TUI sessions",
    handler: async (_args, ctx) => {
      const config = { ...(currentConfig ?? loadConfig()), enabled: true };
      writeConfig(config);
      currentConfig = config;
      if (ctx.mode !== "tui") {
        ctx.ui.notify("Remote control is enabled in config but starts only in Pi TUI mode.", "warning");
        return;
      }
      startServer(ctx);
      ctx.ui.notify(redactedStatusLines(config).join("\n"), "info");
    },
  });
}
