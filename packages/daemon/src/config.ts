import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
export type DaemonConfig = { enabled:boolean; host:string; port:number; allowNoAuthFromLoopback:boolean; legacyToken?:string; maxEvents:number; maxAgeDays:number };
function json(path:string):any { try{return JSON.parse(readFileSync(path,"utf8"));}catch{return undefined;} }
export function loadConfig(root:string):DaemonConfig {
  const own=json(join(root,"daemon.json")) ?? {}; const legacy=json(join(dirname(root),"remote-control.json")) ?? {};
  const deliberate = legacy.enabled === true;
  return { enabled: own.enabled ?? true, host: own.host ?? (deliberate && typeof legacy.host==="string" ? legacy.host : "127.0.0.1"), port: own.port ?? (deliberate && Number.isInteger(legacy.port) ? legacy.port : 37891), allowNoAuthFromLoopback: own.allowNoAuthFromLoopback ?? (deliberate && legacy.allowNoAuthFromLoopback===true), ...(deliberate && typeof legacy.token==="string" ? {legacyToken:legacy.token}:{}), maxEvents: own.maxEvents ?? 1_000_000, maxAgeDays: own.maxAgeDays ?? 30 };
}
