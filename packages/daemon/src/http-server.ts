import { createServer, type Server } from "node:http";
import { createHash } from "node:crypto";
import { isIP } from "node:net";
import { WebSocketServer, WebSocket } from "ws";
import { MAX_WEBSOCKET_PAYLOAD_BYTES, ProtocolSession, redactForLog } from "@nucleoid/pi-remote-protocol";
import type { AuthService } from "./auth.js";
import type { V2SessionManager } from "./v2-session.js";

type Options = { auth: AuthService; host: string; port: number; headCursor: () => number; minimumCursor: () => number; onStop?: () => void; allowNoAuthFromLoopback?: boolean; control?: { accept: (ws: WebSocket) => void }; v2?: { manager: V2SessionManager; history: (processId: string) => any[]; command?: (processId: string, value: any) => void; verifier?: (token?: string) => string } };
const reject = (socket: NodeJS.WritableStream, status: number) => { socket.write(`HTTP/1.1 ${status} ${status === 401 ? "Unauthorized" : "Not Found"}\r\nConnection: close\r\nContent-Length: 0\r\n\r\n`); (socket as any).destroy(); };
const validAdvertisedHost = (value: string) => value.length <= 253 && (isIP(value) !== 0 || /^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?)(?:\.(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?))*$/.test(value));

export function createControlServer(o: Options) {
  let server: Server, enabled = true;
  const wsServer = new WebSocketServer({ noServer: true, maxPayload: MAX_WEBSOCKET_PAYLOAD_BYTES, perMessageDeflate: false });
  const v2Clients = new Map<WebSocket, string>();
  const controlClients = new Set<WebSocket>();
  server = createServer((req, res) => {
    const address = req.socket.remoteAddress ?? "unknown", url = new URL(req.url ?? "/", "http://localhost"), path = url.pathname;
    const ok = o.auth.authorize({ path, address, scope: "admin", header: req.headers.authorization });
    if (!ok) { res.writeHead(o.auth.failureReason(address) === "rate_limited" ? 429 : 401, { "content-type": "application/json", "cache-control": "no-store" }); res.end('{"error":"unauthorized"}'); return; }
    res.setHeader("content-type", "application/json"); res.setHeader("cache-control", "no-store");
    if (req.method === "POST") {
      if (path === "/admin/stop" && o.onStop) { res.writeHead(202); res.end('{"stopping":true}'); setImmediate(o.onStop); return; }
      if (path === "/admin/v2-token") { const processId = url.searchParams.get("processId"), advertised = url.searchParams.get("advertisedHost"); if (!processId || !o.v2) { res.writeHead(400); res.end('{"error":"process_required"}'); return; } const fallback = o.host === "0.0.0.0" || o.host === "::" ? "127.0.0.1" : o.host, selected = advertised ?? fallback; if (!validAdvertisedHost(selected)) { res.writeHead(400); res.end('{"error":"invalid_advertised_host"}'); return; } const token = o.auth.issue("v2", processId); try { const verifier = o.v2.verifier?.(token) ?? createHash("sha256").update(token).digest("hex"); o.v2.manager.assign(verifier, processId); } catch { o.auth.revoke(token); res.writeHead(409); res.end('{"error":"process_unavailable"}'); return; } const host = isIP(selected) === 6 ? `[${selected}]` : selected; res.end(JSON.stringify({ deepLink: `pi-remote://${host}:${api.port}?token=${encodeURIComponent(token)}` })); return; }
      if (path === "/admin/v2-rotate") { o.auth.revokeScope("v2"); for (const ws of v2Clients.keys()) ws.close(1008, "token rotated"); res.end('{"rotated":true}'); return; }
      if (path === "/admin/disable") { enabled = false; for (const ws of wsServer.clients) ws.close(1008, "remote control disabled"); res.end('{"enabled":false}'); return; }
      if (path === "/admin/enable") { enabled = true; res.end('{"enabled":true}'); return; }
      res.writeHead(404); res.end('{"error":"not_found"}'); return;
    }
    if (req.method !== "GET") { res.writeHead(405, { allow: "GET, POST" }); res.end(); return; }
    if (path === "/health/live") res.end(JSON.stringify({ daemon: "pi-remote", version: "0.1.0", live: true }));
    else if (path === "/health/ready") res.end(JSON.stringify({ daemon: "pi-remote", version: "0.1.0", ready: true, enabled, headCursor: o.headCursor(), minimumCursor: o.minimumCursor() }));
    else if (path === "/protocol") res.end(JSON.stringify({ versions: [3, 2], v2Path: "/", v3Path: "/control" }));
    else if (path === "/capabilities") res.end(JSON.stringify({ durableReplay: true, heartbeatIntervalMs: 10000 }));
    else { res.writeHead(404); res.end('{"error":"not_found"}'); }
  });
  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url ?? "/", "http://localhost"), address = req.socket.remoteAddress ?? "unknown";
    if (!enabled) { reject(socket, 503); return; }
    if (url.pathname !== "/" && url.pathname !== "/control") { reject(socket, 404); return; }
    const isV2 = url.pathname === "/";
    const ok = o.auth.authorize({ path: url.pathname, address, scope: isV2 ? "v2" : "admin", header: req.headers.authorization, queryToken: isV2 ? url.searchParams.get("token") ?? undefined : undefined, allowLoopbackBypass: isV2 ? o.allowNoAuthFromLoopback : undefined });
    if (!ok) { reject(socket, o.auth.failureReason(address) === "rate_limited" ? 429 : 401); return; }
    wsServer.handleUpgrade(req, socket, head, ws => {
      if (!isV2) {
        controlClients.add(ws); ws.once("close", () => controlClients.delete(ws));
        if (o.control) { o.control.accept(ws); return; }
        const session = new ProtocolSession([3], []);
        ws.on("message", (data, binary) => { if (binary) { ws.close(1002, "text required"); return; } try { const reply = session.receive(JSON.parse(String(data))); if (reply) ws.send(JSON.stringify(reply)); } catch (e) { const safe = redactForLog(e); ws.send(JSON.stringify({ protocolVersion: 3, type: "protocol_error", code: (safe as any).code ?? "invalid_message", message: "Protocol error" })); ws.close(1002, "protocol error"); } });
        return;
      }
      if (!o.v2) { ws.close(1008, "v2 unavailable"); return; }
      try {
        const verifier = o.v2.verifier?.(url.searchParams.get("token") ?? undefined) ?? createHash("sha256").update(url.searchParams.get("token") ?? "loopback").digest("hex"), processId = o.v2.manager.bindLegacy(verifier);
        v2Clients.set(ws, processId); ws.once("close", () => v2Clients.delete(ws));
        ws.send(JSON.stringify(o.v2.manager.hello(processId)));
        for (const item of o.v2.manager.history(o.v2.history(processId))) ws.send(JSON.stringify(item));
        ws.on("message", (data, binary) => { if (binary) { ws.close(1002, "text required"); return; } try { const value = JSON.parse(String(data)), command = o.v2!.manager.command(value); o.v2!.command?.(processId, command); } catch (error) { if (error instanceof Error && error.message === "target_unavailable") { ws.send(JSON.stringify({ type: "error", code: "target_unavailable" })); return; } ws.send(JSON.stringify({ type: "error", code: "invalid_message" })); ws.close(1002, "invalid message"); } });
      } catch { ws.close(1008, "process unavailable"); }
    });
  });
  const api = {
    listen: () => new Promise<void>((resolve, rejectError) => server.listen(o.port, o.host, resolve).once("error", rejectError)),
    close: () => { for (const ws of wsServer.clients) ws.terminate(); return Promise.all([new Promise<void>((resolve, rejectError) => wsServer.close(e => e ? rejectError(e) : resolve())), new Promise<void>((resolve, rejectError) => server.close(e => e ? rejectError(e) : resolve()))]).then(() => undefined); },
    publishV2(processId: string, event: any) { if (!o.v2) return; const mapped = o.v2.manager.history([event]); for (const value of mapped) for (const [ws, target] of v2Clients) if (target === processId && ws.readyState === WebSocket.OPEN) ws.send(JSON.stringify(value)); },
    get port() { const address = server.address(); return typeof address === "object" && address ? address.port : 0; }, server,
  };
  return api;
}
