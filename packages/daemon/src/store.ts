import Database from "better-sqlite3";
import { randomUUID } from "node:crypto";
import { canonicalJson, isPersistableCommand, ProtocolError, type CommandBody } from "@nucleoid/pi-remote-protocol";
import { migrate } from "./migrations.js";

type Registration = { hostId: string; processId: string; processInstanceId: string; sessionId: string; capabilities?:string[] };
type Publish = { eventId: string; processId: string; processInstanceId: string; processSequence: number; occurredAt: string; event: Record<string, unknown> };

function safeCommandPayload(payload: unknown): unknown {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return payload;
  const command = payload as Record<string, unknown>;
  if (isPersistableCommand(command as CommandBody) && !Object.prototype.hasOwnProperty.call(command, "replacementArgs")) return payload;
  const { replacementArgs: _, ...safe } = command;
  return safe;
}

export class DurableStore {
  readonly db: Database.Database;
  constructor(path: string) {
    this.db = new Database(path);
    this.db.pragma("journal_mode = WAL");
    this.db.pragma("foreign_keys = ON");
    this.db.pragma("busy_timeout = 2500");
    migrate(this.db);
  }
  register(value: Registration): { resumeFromProcessSequence: number; headCursor: number } {
    const now = Date.now();
    this.db.transaction(() => {
      this.db.prepare("INSERT OR IGNORE INTO hosts(host_id) VALUES (?)").run(value.hostId);
      this.db.prepare("INSERT INTO processes(process_id,host_id,session_id,registered_at,capabilities_json) VALUES (?,?,?,?,?) ON CONFLICT(process_id) DO UPDATE SET host_id=excluded.host_id,session_id=excluded.session_id,state='live',capabilities_json=excluded.capabilities_json").run(value.processId,value.hostId,value.sessionId,now,JSON.stringify(value.capabilities??[]));
      this.db.prepare("INSERT OR IGNORE INTO sessions(session_id,process_id) VALUES (?,?)").run(value.sessionId,value.processId);
      this.db.prepare("INSERT INTO process_instances(instance_id,process_id,state,next_sequence,heartbeat_at) VALUES (?,?, 'live',1,?) ON CONFLICT(instance_id) DO UPDATE SET state='live',heartbeat_at=excluded.heartbeat_at").run(value.processInstanceId,value.processId,now);
    })();
    const instance = this.db.prepare("SELECT next_sequence FROM process_instances WHERE instance_id=?").get(value.processInstanceId) as any;
    return { resumeFromProcessSequence: instance.next_sequence, headCursor: this.headCursor };
  }
  appendEvent(value: Publish): { cursor: number; duplicate: boolean; expectedNextSequence: number } {
    return this.db.transaction(() => {
      const canonical = canonicalJson(value);
      const existing = this.db.prepare("SELECT cursor,canonical,instance_id FROM events WHERE event_id=? OR (instance_id=? AND process_sequence=?)").get(value.eventId,value.processInstanceId,value.processSequence) as any;
      const row = this.db.prepare("SELECT process_id,next_sequence FROM process_instances WHERE instance_id=?").get(value.processInstanceId) as any;
      if (!row || row.process_id !== value.processId) throw new ProtocolError("producer_not_registered");
      if (existing) {
        if (existing.canonical !== canonical) throw new ProtocolError("event_conflict", undefined, "event_conflict");
        return { cursor: existing.cursor, duplicate: true, expectedNextSequence: row.next_sequence };
      }
      if (row.next_sequence !== value.processSequence) throw new ProtocolError("process_sequence_gap", "processSequence", "Producer sequence is not contiguous", 1002, { expectedSequence: row.next_sequence });
      const head = this.headCursor;
      if (head >= Number.MAX_SAFE_INTEGER) throw new ProtocolError("cursor_exhausted");
      const cursor = head + 1;
      this.db.prepare("UPDATE schema_meta SET value=? WHERE key='cursor_high_water'").run(String(cursor));
      this.db.prepare("INSERT INTO events(cursor,event_id,process_id,instance_id,process_sequence,occurred_at,canonical,event_json) VALUES (?,?,?,?,?,?,?,?)").run(cursor,value.eventId,value.processId,value.processInstanceId,value.processSequence,value.occurredAt,canonical,JSON.stringify(value.event));
      this.db.prepare("UPDATE process_instances SET next_sequence=next_sequence+1,heartbeat_at=? WHERE instance_id=?").run(Date.now(),value.processInstanceId);
      this.db.prepare("UPDATE processes SET last_cursor=? WHERE process_id=?").run(cursor,value.processId);
      return { cursor, duplicate: false, expectedNextSequence: value.processSequence + 1 };
    })();
  }
  replay(afterCursor: number, processIds?: readonly string[]): Array<Record<string, any>> {
    if (!Number.isSafeInteger(afterCursor) || afterCursor < 0) throw new ProtocolError("invalid_cursor");
    if (afterCursor > this.headCursor) throw new ProtocolError("cursor_ahead");
    const minimum = this.minimumCursor;
    if (afterCursor < minimum - 1) throw new ProtocolError("cursor_expired", undefined, "Cursor expired", 1002, { minimumCursor: minimum });
    let rows: any[];
    if (processIds?.length) {
      const marks = processIds.map(() => "?").join(",");
      rows = this.db.prepare(`SELECT * FROM events WHERE cursor>? AND process_id IN (${marks}) ORDER BY cursor`).all(afterCursor,...processIds);
    } else rows = this.db.prepare("SELECT * FROM events WHERE cursor>? ORDER BY cursor").all(afterCursor);
    return rows.map(row => ({ cursor: row.cursor, eventId: row.event_id, processId: row.process_id, processInstanceId: row.instance_id, processSequence: row.process_sequence, occurredAt: row.occurred_at, event: JSON.parse(row.event_json) }));
  }
  pin(cursor:number,principal:string): void { this.db.prepare("INSERT OR IGNORE INTO pins(cursor,principal,created_at) VALUES (?,?,?)").run(cursor,principal,Date.now()); }
  leaseReplay(minimumCursor:number,ttlMs:number): string { const id=randomUUID(); this.db.prepare("INSERT INTO replay_leases(lease_id,minimum_cursor,expires_at) VALUES (?,?,?)").run(id,minimumCursor,Date.now()+ttlMs); return id; }
  releaseReplay(id:string): void { this.db.prepare("DELETE FROM replay_leases WHERE lease_id=?").run(id); }
  retain(options: { maxEvents: number; maxAgeMs: number; now: number }): number {
    const protectedCursor = (this.db.prepare("SELECT MIN(minimum_cursor) value FROM replay_leases WHERE expires_at>?").get(options.now) as any)?.value ?? Number.MAX_SAFE_INTEGER;
    const countCutoff = options.maxEvents <= 0 ? this.headCursor : Math.max(0, this.headCursor - options.maxEvents);
    const ageTime = options.maxAgeMs <= 0 ? options.now + 1 : options.now - options.maxAgeMs;
    return this.db.prepare("DELETE FROM events WHERE cursor<? AND cursor NOT IN (SELECT cursor FROM pins) AND (cursor<=? OR occurred_at<?)").run(protectedCursor,countCutoff,new Date(ageTime).toISOString()).changes;
  }
  getProcess(processId: string): { lastCursor: number; state: string; sessionId:string; processInstanceId?:string; capabilities:string[] } | undefined {
    const row = this.db.prepare("SELECT p.last_cursor,p.state,p.session_id,p.capabilities_json,(SELECT instance_id FROM process_instances i WHERE i.process_id=p.process_id AND i.state='live' ORDER BY rowid DESC LIMIT 1) instance_id FROM processes p WHERE process_id=?").get(processId) as any;
    return row && { lastCursor: row.last_cursor, state: row.state,sessionId:row.session_id,processInstanceId:row.instance_id,capabilities:JSON.parse(row.capabilities_json) };
  }
  listProcesses():Array<{processId:string;registeredAt:number;live:boolean}>{return (this.db.prepare("SELECT process_id,registered_at,state FROM processes ORDER BY registered_at,process_id").all() as any[]).map(x=>({processId:x.process_id,registeredAt:x.registered_at,live:x.state==='live'}));}
  heartbeat(instanceId:string):void{this.db.prepare("UPDATE process_instances SET state='live',heartbeat_at=? WHERE instance_id=?").run(Date.now(),instanceId);}
  setInstanceState(instanceId:string,state:'live'|'stale'|'dead'):void{this.db.transaction(()=>{this.db.prepare("UPDATE process_instances SET state=? WHERE instance_id=?").run(state,instanceId);this.db.prepare("UPDATE processes SET state=? WHERE process_id=(SELECT process_id FROM process_instances WHERE instance_id=?)").run(state,instanceId);})();}
  getV2Assignment(verifier:string):string|undefined{return (this.db.prepare("SELECT process_id FROM v2_assignments WHERE verifier=?").get(verifier) as any)?.process_id;}
  saveV2Assignment(verifier:string,processId:string):void{this.db.prepare("INSERT OR IGNORE INTO v2_assignments(verifier,process_id,created_at) VALUES (?,?,?)").run(verifier,processId,Date.now());}
  acceptCommand(principal:string,value:{commandId:string;processId:string;processInstanceId:string;payload:unknown;expiresAt?:number}):{duplicate:boolean;state:string;result?:unknown}{return this.db.transaction(()=>{const persistedValue={...value,payload:safeCommandPayload(value.payload)};const canonical=canonicalJson({principal,value:persistedValue});const old=this.db.prepare("SELECT canonical,state,result_json FROM commands WHERE command_id=?").get(value.commandId) as any;if(old){if(old.canonical!==canonical)throw new ProtocolError('command_conflict');return{duplicate:true,state:old.state,...(old.result_json?{result:JSON.parse(old.result_json)}:{})};}this.db.prepare("INSERT INTO commands(command_id,principal,canonical,process_id,instance_id,state,expires_at) VALUES (?,?,?,?,?,'accepted',?)").run(value.commandId,principal,canonical,value.processId,value.processInstanceId,value.expiresAt??Date.now()+30000);return{duplicate:false,state:'accepted'};})();}
  completeCommand(commandId:string,result:unknown):void{this.db.transaction(()=>{const row=this.db.prepare("SELECT state,result_json FROM commands WHERE command_id=?").get(commandId) as any;if(!row)throw new ProtocolError('result_before_ack');const canonical=canonicalJson(result);if(row.result_json&&canonicalJson(JSON.parse(row.result_json))!==canonical)throw new ProtocolError('command_result_conflict');this.db.prepare("UPDATE commands SET state=?,result_json=? WHERE command_id=?").run((result as any).status,JSON.stringify(result),commandId);})();}
  failCommandsForInstance(instanceId:string):void{this.db.prepare("UPDATE commands SET state='failed:bridge_disconnected',result_json=? WHERE instance_id=? AND state='accepted'").run(JSON.stringify({status:'failed',error:{code:'bridge_disconnected',message:'Bridge disconnected'}}),instanceId);}
  recoverAfterRestart(): number {
    return this.db.transaction(() => {
      const rows = this.db.prepare("SELECT i.instance_id,i.process_id,i.next_sequence FROM process_instances i WHERE i.state IN ('live','stale')").all() as any[];
      for (const row of rows) {
        const minimum=(this.db.prepare("SELECT MIN(process_sequence) value FROM events WHERE instance_id=?").get(row.instance_id) as any).value as number|null;
        const syntheticSequence=minimum===null||minimum>0?0:minimum-1;
        const cursor=this.headCursor+1, eventId=randomUUID(), occurredAt=new Date().toISOString();
        const value={eventId,processId:row.process_id,processInstanceId:row.instance_id,processSequence:syntheticSequence,occurredAt,event:{type:'status',code:'instance_lost'}};
        this.db.prepare("UPDATE schema_meta SET value=? WHERE key='cursor_high_water'").run(String(cursor));
        this.db.prepare("INSERT INTO events(cursor,event_id,process_id,instance_id,process_sequence,occurred_at,canonical,event_json) VALUES (?,?,?,?,?,?,?,?)").run(cursor,eventId,row.process_id,row.instance_id,syntheticSequence,occurredAt,canonicalJson(value),JSON.stringify(value.event));
        this.db.prepare("UPDATE process_instances SET state='lost' WHERE instance_id=?").run(row.instance_id);
        this.db.prepare("UPDATE processes SET state='lost',last_cursor=? WHERE process_id=?").run(cursor,row.process_id);
      }
      return rows.length;
    })();
  }
  get headCursor(): number { return Number((this.db.prepare("SELECT value FROM schema_meta WHERE key='cursor_high_water'").get() as any).value); }
  get minimumCursor(): number { return (this.db.prepare("SELECT MIN(cursor) value FROM events").get() as any)?.value ?? this.headCursor + 1; }
  checkpoint(): void { this.db.pragma("wal_checkpoint(PASSIVE)"); }
  close(): void { this.db.close(); }
}
