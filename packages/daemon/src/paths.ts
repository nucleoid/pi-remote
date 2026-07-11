import path from "node:path";
import { homedir } from "node:os";
export type ProfilePaths = ReturnType<typeof profilePaths>;
export function profilePaths(agentRoot = path.join(homedir(),".pi","agent"), platform: NodeJS.Platform = process.platform) {
  const api = platform === "win32" ? path.win32 : path.posix;
  const root = api.join(agentRoot,"pi-remote");
  return { root, config: api.join(root,"daemon.json"), database: api.join(root,"control.db"), lock: api.join(root,"daemon.lock"), credentials: api.join(root,"credentials.json"), legacyConfig: api.join(agentRoot,"remote-control.json") };
}
