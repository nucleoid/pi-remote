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
