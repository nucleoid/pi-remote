// @ts-nocheck
import type { ExtensionAPI, ExtensionContext } from "@earendil-works/pi-coding-agent";
import { WebSocketServer, WebSocket } from "ws";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
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
}

const CONFIG_DIR = join(homedir(), ".pi", "agent");
const CONFIG_PATH = join(CONFIG_DIR, "remote-control.json");

const DEFAULT_CONFIG: Omit<RemoteConfig, "token"> = {
  enabled: true,
  host: "127.0.0.1",
  port: 37891,
  allowNoAuthFromLoopback: false,
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
    writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
    return config;
  }

  const parsed = JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  const config: RemoteConfig = {
    ...DEFAULT_CONFIG,
    ...parsed,
    token: parsed.token || randomBytes(24).toString("base64url"),
  };

  // Persist migrations/defaulted fields.
  writeFileSync(CONFIG_PATH, JSON.stringify(config, null, 2) + "\n", "utf8");
  return config;
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
      if (entry.family === "IPv4" && !entry.internal) candidates.push({ name, address: entry.address, cidr: entry.cidr });
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

function authenticate(req: any, config: RemoteConfig): boolean {
  const remoteAddress = req.socket?.remoteAddress ?? "";
  const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
  const queryToken = url.searchParams.get("token");
  const auth = req.headers.authorization;
  const bearer = typeof auth === "string" && auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : undefined;

  const isLoopback = remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1";
  if (config.allowNoAuthFromLoopback && isLoopback) return true;
  return queryToken === config.token || bearer === config.token;
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
  server.on("connection", (ws, req) => {
    if (!authenticate(req, config)) {
      send(ws, { type: "error", error: "unauthorized" });
      ws.close(1008, "unauthorized");
      return;
    }

    send(ws, remoteHello(publicState()));
    send(ws, { type: "history", messages: recentMessages(50), state: publicState() });
    broadcast({ type: "client_count", count: wss?.clients.size ?? 0 });

    ws.on("message", (data) => {
      try {
        handleCommand(ws, JSON.parse(data.toString("utf8")));
      } catch (error: any) {
        send(ws, { type: "response", success: false, error: `Invalid JSON: ${error?.message ?? String(error)}` });
      }
    });

    ws.on("close", () => broadcast({ type: "client_count", count: wss?.clients.size ?? 0 }));
  });
}

function announceListening(ctx: ExtensionContext, config: RemoteConfig) {
  const host = connectionHost(config);
  const lanHint = `${host}:${currentPort ?? config.port}`;
  ctx.ui.setStatus("remote", `remote ${lanHint}`);
  ctx.ui.notify(
    [
      `Remote control listening on ${webSocketUrl(config)}`,
      `Android deep link: ${deepLinkUrl(config)}`,
      `Config: ${CONFIG_PATH}`,
    ].join("\n"),
    "info",
  );
}

function startServer(ctx: ExtensionContext) {
  if (started) return;
  started = true;

  currentConfig = loadConfig();
  const config = currentConfig;
  if (!config.enabled || ctx.mode !== "tui") {
    ctx.ui.setStatus("remote", undefined);
    return;
  }

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
      ctx.ui.notify(
        [
          `Remote control: ${config.enabled ? "enabled" : "disabled"}`,
          `WebSocket: ${webSocketUrl(config)}`,
          `Android deep link: ${deepLinkUrl(config)}`,
          `QR: run /remote-control-qr`,
          `Config: ${CONFIG_PATH}`,
          `For Android over LAN, set host to \"0.0.0.0\" and restart or /reload.`,
        ].join("\n"),
        "info",
      );
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
          "Scan with your phone camera to open Pi Remote:",
          "",
          qr,
          "",
          link,
        ].join("\n"),
        "info",
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
        await runAdb(["shell", "am", "start", "-a", "android.intent.action.VIEW", "-d", link, "com.mstat.piremote"]);
        ctx.ui.notify(`Opened Pi Remote on Android.\n${link}`, "info");
      } catch (error: any) {
        ctx.ui.notify(`Failed to open Android app via adb:\n${error?.message ?? String(error)}\n\nDeep link:\n${link}`, "error");
      }
    },
  });
}
