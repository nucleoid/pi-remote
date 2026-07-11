import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { test } from "node:test";
import WebSocket from "ws";
import { LocalDaemon } from "../src/daemon.js";
import { DurableStore } from "../src/store.js";
import { ids, tempProfile } from "./helpers.js";

function peer(url: string, token?: string) {
  const ws = new WebSocket(url, token ? { headers: { authorization: `Bearer ${token}` } } : undefined);
  const queued: any[] = [], waiting: Array<(value:any)=>void> = [];
  ws.on("message", data => { const value=JSON.parse(String(data)); const resolve=waiting.shift(); resolve ? resolve(value) : queued.push(value); });
  return { ws, open: () => ws.readyState===WebSocket.OPEN?Promise.resolve():new Promise<void>((resolve,reject)=>ws.once("open",resolve).once("error",reject)), next: () => queued.length ? Promise.resolve(queued.shift()) : Promise.race([new Promise<any>(resolve=>waiting.push(resolve)),new Promise<never>((_,reject)=>setTimeout(()=>reject(new Error("message timeout")),3000))]), send: (value:any)=>ws.send(JSON.stringify(value)) };
}
async function negotiate(p:ReturnType<typeof peer>,role:"bridge"|"client") { await p.open(); p.send({protocolVersion:3,type:"hello",role,supportedVersions:[3],capabilities:["events.publish","events.replay","commands.prompt"]}); assert.equal((await p.next()).type,"welcome"); }

const register = (x:ReturnType<typeof ids>) => ({protocolVersion:3,type:"process.register",...x,metadata:{},capabilities:["commands.prompt"],heartbeatIntervalMs:10000,nextProcessSequence:1});
const publish = (x:ReturnType<typeof ids>, sequence:number, text:string) => ({protocolVersion:3,type:"event.publish",eventId:randomUUID(),processId:x.processId,processInstanceId:x.processInstanceId,processSequence:sequence,occurredAt:new Date().toISOString(),event:{type:"assistant_delta",text}});

test("running LocalDaemon assembles durable v3 replay, registry, command routing, and Android v2", async()=>{
  const profile=tempProfile(), legacyToken="android-secret";
  const daemon=new LocalDaemon({profileRoot:profile.path,host:"127.0.0.1",port:0,legacyToken});
  await daemon.start();
  const url=`ws://127.0.0.1:${daemon.endpoint.port}`;
  const bridge=peer(`${url}/control`,daemon.adminToken), client=peer(`${url}/control`,daemon.adminToken);
  try {
    const x=ids();
    await negotiate(bridge,"bridge"); bridge.send(register(x)); const registered=await bridge.next(); assert.equal(registered.type,"process.registered");
    await negotiate(client,"client"); client.send({protocolVersion:3,type:"events.subscribe",afterCursor:0});
    const firstEvent=publish(x,1,"durable"); bridge.send(firstEvent);
    assert.deepEqual(await bridge.next(),{protocolVersion:3,type:"event.ack",eventId:firstEvent.eventId,cursor:1,expectedNextProcessSequence:2,duplicate:false});
    const live=await client.next(); assert.equal(live.type,"event.committed"); assert.equal(live.cursor,1); assert.equal(live.event.text,"durable");

    const commandId=randomUUID(); client.send({protocolVersion:3,type:"command.request",commandId,targetProcessId:x.processId,sessionId:x.sessionId,command:{type:"prompt",text:"hello"}});
    assert.deepEqual(await client.next(),{protocolVersion:3,type:"command.ack",commandId,status:"accepted"});
    const routed=await bridge.next(); assert.equal(routed.type,"command.request"); assert.equal(routed.processInstanceId,x.processInstanceId);
    bridge.send({protocolVersion:3,type:"command.result",commandId,status:"completed",result:{ok:true},processId:"spoofed"});
    const result=await client.next(); assert.equal(result.type,"command.result"); assert.deepEqual(result.result,{ok:true});

    client.ws.close();
    const resumed=peer(`${url}/control`,daemon.adminToken); await negotiate(resumed,"client"); resumed.send({protocolVersion:3,type:"events.subscribe",afterCursor:0}); assert.equal((await resumed.next()).cursor,1); resumed.ws.close();

    const android=peer(`${url}/?token=${legacyToken}`); await android.open(); assert.equal((await android.next()).protocolVersion,2); assert.equal((await android.next()).text,"durable"); android.send({type:"prompt",text:"from android"}); const v2Command=await bridge.next(); assert.equal(v2Command.command.text,"from android"); android.ws.close();
  } finally { bridge.ws.close(); client.ws.close(); await daemon.stop(); profile.cleanup(); }
});

test("authenticated dashboard leases route ephemeral gate and pause frames and disconnect once", async () => {
  const profile=tempProfile(),daemon=new LocalDaemon({profileRoot:profile.path,host:"127.0.0.1",port:0}); await daemon.start();
  const url=`ws://127.0.0.1:${daemon.endpoint.port}/control`,bridge=peer(url,daemon.adminToken),dashboard=peer(url,daemon.adminToken);
  try {
    const x=ids(); await negotiate(bridge,"bridge"); bridge.send(register(x)); await bridge.next(); await negotiate(dashboard,"client");
    const requestId=randomUUID(); dashboard.send({protocolVersion:3,type:"dashboard.lease.acquire",requestId,targetProcessId:x.processId,sessionId:x.sessionId});
    const granted=await dashboard.next(); assert.equal(granted.type,"dashboard.lease.granted"); assert.equal(granted.requestId,requestId);
    dashboard.send({protocolVersion:3,type:"tool_gate.policy",leaseId:granted.leaseId,targetProcessId:x.processId,sessionId:x.sessionId,failMode:"failClosed",timeoutMs:1000,includeArguments:true,persistent:true,persistable:false});
    assert.equal((await bridge.next()).type,"tool_gate.policy");
    dashboard.send({protocolVersion:3,type:"pause.arm",leaseId:granted.leaseId,targetProcessId:x.processId,sessionId:x.sessionId,deadline:new Date(Date.now()+1000).toISOString(),disconnectMode:"resume",persistable:false});
    assert.equal((await bridge.next()).type,"pause.arm");
    bridge.send({protocolVersion:3,type:"tool_gate.request",leaseId:granted.leaseId,targetProcessId:x.processId,sessionId:x.sessionId,toolCallId:"call",toolName:"demo",persistable:false,metadata:{argumentKeys:["secret"]},arguments:{secret:"never-store"}});
    assert.equal((await dashboard.next()).arguments.secret,"never-store");
    dashboard.send({protocolVersion:3,type:"tool_gate.decision",leaseId:granted.leaseId,targetProcessId:x.processId,sessionId:x.sessionId,toolCallId:"call",decision:"allow",replacementArgs:{secret:"replacement-never-store"},persistable:false});
    assert.equal((await bridge.next()).replacementArgs.secret,"replacement-never-store");
    dashboard.ws.close(); assert.deepEqual(await bridge.next(),{protocolVersion:3,type:"dashboard.disconnected",leaseId:granted.leaseId});
    const store=new DurableStore(join(profile.path,"control.db")); try { assert.doesNotMatch(JSON.stringify(store.replay(0)),/never-store/); } finally { store.close(); }
  } finally { bridge.ws.close(); dashboard.ws.close(); await daemon.stop(); profile.cleanup(); }
});

test("lease ownership, session target, late release and spoofed decisions are rejected", async () => {
  const profile=tempProfile(),daemon=new LocalDaemon({profileRoot:profile.path,host:"127.0.0.1",port:0}); await daemon.start();
  const url=`ws://127.0.0.1:${daemon.endpoint.port}/control`,bridge=peer(url,daemon.adminToken),owner=peer(url,daemon.adminToken),spoof=peer(url,daemon.adminToken);
  try { const x=ids(); await negotiate(bridge,"bridge"); bridge.send(register(x)); await bridge.next(); await negotiate(owner,"client"); await negotiate(spoof,"client"); owner.send({protocolVersion:3,type:"dashboard.lease.acquire",requestId:randomUUID(),targetProcessId:x.processId,sessionId:x.sessionId}); const lease=(await owner.next()).leaseId;
    spoof.send({protocolVersion:3,type:"pause.resume",leaseId:lease,targetProcessId:x.processId,sessionId:x.sessionId}); assert.equal((await spoof.next()).type,"protocol_error");
    owner.send({protocolVersion:3,type:"dashboard.lease.release",leaseId:lease}); assert.equal((await bridge.next()).type,"dashboard.disconnected");
    owner.send({protocolVersion:3,type:"dashboard.lease.release",leaseId:lease}); assert.equal((await owner.next()).type,"protocol_error");
  } finally { bridge.ws.close(); owner.ws.close(); spoof.ws.close(); await daemon.stop(); profile.cleanup(); }
});

test("leases survive transient target loss but are revoked before a replacement process instance can inherit policy", async () => {
  const profile=tempProfile(),daemon=new LocalDaemon({profileRoot:profile.path,host:"127.0.0.1",port:0}); await daemon.start(); const url=`ws://127.0.0.1:${daemon.endpoint.port}/control`;
  let bridge=peer(url,daemon.adminToken); const dashboard=peer(url,daemon.adminToken);
  try { const x=ids(); await negotiate(bridge,"bridge"); bridge.send(register(x)); await bridge.next(); await negotiate(dashboard,"client"); dashboard.send({protocolVersion:3,type:"dashboard.lease.acquire",requestId:randomUUID(),targetProcessId:x.processId,sessionId:x.sessionId}); const lease=(await dashboard.next()).leaseId;
    bridge.ws.close(); await new Promise(resolve=>setTimeout(resolve,30)); dashboard.send({protocolVersion:3,type:"pause.resume",leaseId:lease,targetProcessId:x.processId,sessionId:x.sessionId}); const unavailable=await dashboard.next(); assert.equal(unavailable.type,"dashboard.lease.error"); assert.equal(unavailable.code,"target_unavailable"); assert.equal(dashboard.ws.readyState,WebSocket.OPEN);
    bridge=peer(url,daemon.adminToken); await negotiate(bridge,"bridge"); bridge.send(register(x)); await bridge.next(); dashboard.send({protocolVersion:3,type:"tool_gate.policy",leaseId:lease,targetProcessId:x.processId,sessionId:x.sessionId,failMode:"failClosed",timeoutMs:1000,includeArguments:false,persistent:true,persistable:false}); assert.equal((await bridge.next()).type,"tool_gate.policy");
    bridge.ws.close(); await new Promise(resolve=>setTimeout(resolve,30)); const replacement={...x,processInstanceId:randomUUID()}; bridge=peer(url,daemon.adminToken); await negotiate(bridge,"bridge"); bridge.send(register(replacement)); await bridge.next(); const revoked=await dashboard.next(); assert.equal(revoked.type,"dashboard.lease.revoked"); assert.equal(revoked.reason,"target_replaced");
  } finally { bridge.ws.close(); dashboard.ws.close(); await daemon.stop(); profile.cleanup(); }
});

test("configured root-v2 loopback bypass reaches the running server only on root",async()=>{
  const profile=tempProfile(),daemon=new LocalDaemon({profileRoot:profile.path,host:"127.0.0.1",port:0,allowNoAuthFromLoopback:true}); await daemon.start();
  const bridge=peer(`ws://127.0.0.1:${daemon.endpoint.port}/control`,daemon.adminToken);
  try{const x=ids();await negotiate(bridge,"bridge");bridge.send(register(x));await bridge.next();const android=peer(`ws://127.0.0.1:${daemon.endpoint.port}/`);await android.open();assert.equal((await android.next()).protocolVersion,2);android.ws.close();const unauthorized=peer(`ws://127.0.0.1:${daemon.endpoint.port}/control`);await assert.rejects(unauthorized.open());}finally{bridge.ws.close();await daemon.stop();profile.cleanup();}
});

test("Android v2 starts at retained history after global cursor compaction", async () => {
  const profile=tempProfile(),x=ids(),legacyToken="retained-android";
  const store=new DurableStore(join(profile.path,"control.db"));
  store.register({...x,capabilities:["commands.prompt"]});
  store.appendEvent(publish(x,1,"pruned"));
  store.appendEvent(publish(x,2,"retained"));
  store.retain({maxEvents:1,maxAgeMs:100*365*86400000,now:Date.now()});
  assert.equal(store.minimumCursor,2);
  store.close();
  const daemon=new LocalDaemon({profileRoot:profile.path,host:"127.0.0.1",port:0,legacyToken});
  await daemon.start();
  const bridge=peer(`ws://127.0.0.1:${daemon.endpoint.port}/control`,daemon.adminToken);
  try {
    await negotiate(bridge,"bridge"); bridge.send({...register(x),nextProcessSequence:3}); await bridge.next();
    const android=peer(`ws://127.0.0.1:${daemon.endpoint.port}/?token=${legacyToken}`);
    await android.open();
    assert.equal((await android.next()).protocolVersion,2);
    assert.equal((await android.next()).text,"retained");
    android.ws.close();
  } finally { bridge.ws.close(); await daemon.stop(); profile.cleanup(); }
});
