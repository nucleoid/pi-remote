import type Database from "better-sqlite3";

const migrations = [
  `CREATE TABLE schema_meta (key TEXT PRIMARY KEY, value TEXT NOT NULL);
   INSERT INTO schema_meta(key,value) VALUES ('version','1'),('cursor_high_water','0');
   CREATE TABLE hosts (host_id TEXT PRIMARY KEY, metadata_json TEXT NOT NULL DEFAULT '{}');
   CREATE TABLE processes (process_id TEXT PRIMARY KEY, host_id TEXT NOT NULL, session_id TEXT NOT NULL, last_cursor INTEGER NOT NULL DEFAULT 0, state TEXT NOT NULL DEFAULT 'live');
   CREATE TABLE process_instances (instance_id TEXT PRIMARY KEY, process_id TEXT NOT NULL, state TEXT NOT NULL, next_sequence INTEGER NOT NULL DEFAULT 1, heartbeat_at INTEGER NOT NULL);
   CREATE TABLE sessions (session_id TEXT PRIMARY KEY, process_id TEXT NOT NULL, state TEXT NOT NULL DEFAULT 'live');
   CREATE TABLE events (cursor INTEGER PRIMARY KEY, event_id TEXT NOT NULL UNIQUE, process_id TEXT NOT NULL, instance_id TEXT NOT NULL, process_sequence INTEGER NOT NULL, occurred_at TEXT NOT NULL, canonical TEXT NOT NULL, event_json TEXT NOT NULL, UNIQUE(instance_id,process_sequence));
   CREATE INDEX events_process_cursor ON events(process_id,cursor);
   CREATE TABLE commands (command_id TEXT PRIMARY KEY, principal TEXT NOT NULL, canonical TEXT NOT NULL, process_id TEXT NOT NULL, instance_id TEXT NOT NULL, state TEXT NOT NULL, result_json TEXT, expires_at INTEGER NOT NULL);
   CREATE TABLE pins (cursor INTEGER PRIMARY KEY, principal TEXT NOT NULL, created_at INTEGER NOT NULL);
   CREATE TABLE replay_leases (lease_id TEXT PRIMARY KEY, minimum_cursor INTEGER NOT NULL, expires_at INTEGER NOT NULL);`,
  `ALTER TABLE processes ADD COLUMN registered_at INTEGER NOT NULL DEFAULT 0;
   ALTER TABLE processes ADD COLUMN capabilities_json TEXT NOT NULL DEFAULT '[]';
   CREATE TABLE v2_assignments (verifier TEXT PRIMARY KEY, process_id TEXT NOT NULL, created_at INTEGER NOT NULL);
   UPDATE schema_meta SET value='2' WHERE key='version';`
] as const;

export function migrate(db: Database.Database): void {
  const exists = db.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name='schema_meta'").get();
  if (!exists) db.transaction(() => db.exec(migrations[0]))();
  let version=Number((db.prepare("SELECT value FROM schema_meta WHERE key='version'").get() as any).value);
  while(version<migrations.length){db.transaction(()=>db.exec(migrations[version]))();version++;}
}
