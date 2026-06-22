#!/usr/bin/env node
import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";
import { WebSocket } from "ws";

const CONFIG_PATH = join(homedir(), ".pi", "agent", "remote-control.json");

function usage() {
  console.log(`
Pi remote-control test client

Usage:
  node client.mjs [options] <command> [text]

Commands:
  ping
  state
  prompt <text>
  steer <text>
  follow-up <text>
  abort
  listen

Options:
  --host <host>       Override config host. Use 127.0.0.1 for local testing.
  --port <port>       Override config port.
  --token <token>     Override config token.
  --url <ws-url>      Full websocket URL. Token query is optional if --token is set.
  --no-stream         Exit after command response instead of streaming until agent_end.

Examples:
  node client.mjs state
  node client.mjs --host 127.0.0.1 prompt "Say hello"
  node client.mjs steer "Focus on tests"
  node client.mjs listen
`);
}

function parseArgs(argv) {
  const opts = { stream: true };
  const positional = [];
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    switch (arg) {
      case "--help":
      case "-h":
        usage();
        process.exit(0);
      case "--host":
        opts.host = argv[++i];
        break;
      case "--port":
        opts.port = Number(argv[++i]);
        break;
      case "--token":
        opts.token = argv[++i];
        break;
      case "--url":
        opts.url = argv[++i];
        break;
      case "--no-stream":
        opts.stream = false;
        break;
      default:
        positional.push(arg);
    }
  }
  return { opts, command: positional[0], text: positional.slice(1).join(" ") };
}

function loadConfig() {
  try {
    return JSON.parse(readFileSync(CONFIG_PATH, "utf8"));
  } catch {
    return {};
  }
}

function buildUrl(opts, config) {
  if (opts.url) {
    const url = new URL(opts.url);
    if (!url.searchParams.has("token") && (opts.token || config.token)) {
      url.searchParams.set("token", opts.token || config.token);
    }
    return url.toString();
  }

  const host = opts.host || (config.host === "0.0.0.0" ? "127.0.0.1" : config.host) || "127.0.0.1";
  const port = opts.port || config.port || 37891;
  const token = opts.token || config.token;
  const url = new URL(`ws://${host}:${port}`);
  if (token) url.searchParams.set("token", token);
  return url.toString();
}

function commandMessage(command, text) {
  const id = `${Date.now()}-${Math.random().toString(16).slice(2)}`;
  switch (command) {
    case "ping":
      return { id, type: "ping" };
    case "state":
    case "get-state":
    case "get_state":
      return { id, type: "get_state" };
    case "prompt":
      if (!text) throw new Error("prompt requires text");
      return { id, type: "prompt", text };
    case "steer":
      if (!text) throw new Error("steer requires text");
      return { id, type: "steer", text };
    case "follow-up":
    case "follow_up":
    case "followUp":
      if (!text) throw new Error("follow-up requires text");
      return { id, type: "follow_up", text };
    case "abort":
      return { id, type: "abort" };
    case "listen":
      return undefined;
    default:
      throw new Error(`Unknown command: ${command || "(missing)"}`);
  }
}

function printEvent(msg) {
  switch (msg.type) {
    case "hello":
      console.log(`connected: ${msg.state?.cwd || "unknown cwd"}`);
      break;
    case "assistant_delta":
      process.stdout.write(msg.text);
      break;
    case "thinking_delta":
      break;
    case "tool_start":
      console.log(`\n\n[tool start] ${msg.toolName} ${JSON.stringify(msg.args)}`);
      break;
    case "tool_update":
      break;
    case "tool_end":
      console.log(`\n[tool end] ${msg.toolName} ${msg.isError ? "ERROR" : "OK"}`);
      break;
    case "agent_start":
      console.log("\n[agent start]");
      break;
    case "agent_end":
      console.log("\n[agent end]");
      break;
    case "queue_update":
      console.log(`\n[queue] steering=${msg.steering?.length ?? 0} followUp=${msg.followUp?.length ?? 0}`);
      break;
    case "response":
      console.log(`\n[response] ${msg.success ? "ok" : "error"}${msg.error ? `: ${msg.error}` : ""}`);
      if (msg.data) console.log(JSON.stringify(msg.data, null, 2));
      break;
    case "client_count":
      console.log(`[clients] ${msg.count}`);
      break;
    default:
      console.log(`\n[event] ${JSON.stringify(msg)}`);
      break;
  }
}

const { opts, command, text } = parseArgs(process.argv.slice(2));
if (!command) {
  usage();
  process.exit(1);
}

let outbound;
try {
  outbound = commandMessage(command, text);
} catch (error) {
  console.error(error.message);
  usage();
  process.exit(1);
}

const config = loadConfig();
const url = buildUrl(opts, config);
const ws = new WebSocket(url);
let commandResponseSeen = !outbound;

const failTimer = setTimeout(() => {
  console.error("Timed out connecting or waiting for response.");
  process.exit(2);
}, 15000);

ws.on("open", () => {
  if (outbound) ws.send(JSON.stringify(outbound));
});

ws.on("message", (buf) => {
  const msg = JSON.parse(buf.toString("utf8"));
  printEvent(msg);

  if (outbound && msg.type === "response" && msg.id === outbound.id) {
    commandResponseSeen = true;
    if (!opts.stream || ["ping", "get_state", "abort"].includes(outbound.type)) {
      clearTimeout(failTimer);
      ws.close();
      process.exit(msg.success ? 0 : 1);
    }
  }

  if (commandResponseSeen && msg.type === "agent_end" && command !== "listen") {
    clearTimeout(failTimer);
    ws.close();
    process.exit(0);
  }
});

ws.on("error", (err) => {
  clearTimeout(failTimer);
  console.error(`WebSocket error: ${err.message}`);
  process.exit(1);
});

ws.on("close", () => {
  clearTimeout(failTimer);
  if (command === "listen") process.exit(0);
});
