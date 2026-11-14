import { mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

export interface Migration {
  version: number;
  name: string;
  sql: string;
}

/** 全量初始 schema（v1）。后续变更以新 migration 追加。 */
const MIGRATIONS: Migration[] = [
  {
    version: 1,
    name: 'init',
    sql: `
CREATE TABLE IF NOT EXISTS kv_config (k TEXT PRIMARY KEY, v TEXT NOT NULL, updated_at TEXT NOT NULL);

CREATE TABLE IF NOT EXISTS accounts (
  account_id TEXT PRIMARY KEY,
  name TEXT NOT NULL DEFAULT '',
  owner_name TEXT,
  owner_ct_id TEXT,
  login_mode TEXT NOT NULL DEFAULT 'dingtalk_sso_qr',
  dingtalk_org TEXT,
  fuma_enterprise TEXT,
  capacity_limit INTEGER NOT NULL DEFAULT 500,
  capacity_source TEXT NOT NULL DEFAULT 'default',
  status TEXT NOT NULL DEFAULT 'inactive',
  keep_browser_alive INTEGER NOT NULL DEFAULT 0,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS sessions (
  account_id TEXT PRIMARY KEY REFERENCES accounts(account_id),
  state TEXT NOT NULL,
  mode TEXT NOT NULL,
  c_id INTEGER, ct_id INTEGER,
  access_token_enc TEXT, individual_token_enc TEXT,
  token_created_at INTEGER, token_expire_at INTEGER,
  last_heartbeat_at TEXT, last_error TEXT,
  qr_payload TEXT, qr_expires_at TEXT, qr_refresh_count INTEGER NOT NULL DEFAULT 0,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS customers (
  customer_id TEXT PRIMARY KEY,
  account_id TEXT,
  c_id INTEGER,
  cust_name TEXT, cust_short_name TEXT, bill_code TEXT,
  country_id INTEGER, web TEXT, tel TEXT, mobile TEXT,
  cust_level INTEGER, cust_source INTEGER, cust_state INTEGER,
  seas_flag INTEGER NOT NULL DEFAULT 0,
  owner_ct_id TEXT, owner_dept_key TEXT,
  will_in_sea_at TEXT, last_track_at TEXT, protect_start_at TEXT, released_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'synced',
  sync_version INTEGER NOT NULL DEFAULT 0,
  raw_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_customers_account ON customers(account_id);
CREATE INDEX IF NOT EXISTS idx_customers_seas ON customers(seas_flag);
CREATE INDEX IF NOT EXISTS idx_customers_will_sea ON customers(will_in_sea_at);
CREATE INDEX IF NOT EXISTS idx_customers_sync ON customers(sync_state);

CREATE TABLE IF NOT EXISTS contacts (
  contact_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  account_id TEXT,
  name TEXT, email TEXT, whatsapp TEXT, mobile TEXT, tel TEXT,
  position TEXT, role TEXT, is_primary INTEGER NOT NULL DEFAULT 0,
  last_track_at TEXT,
  sync_state TEXT NOT NULL DEFAULT 'synced', raw_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_contacts_customer ON contacts(customer_id);

CREATE TABLE IF NOT EXISTS followups (
  followup_id TEXT PRIMARY KEY,
  customer_id TEXT NOT NULL,
  contact_id TEXT,
  account_id TEXT NOT NULL,
  method TEXT, content TEXT,
  followed_at TEXT, next_followup_at TEXT,
  related_module TEXT, related_id TEXT,
  sync_state TEXT NOT NULL DEFAULT 'synced', raw_json TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_followups_customer ON followups(customer_id, followed_at);

CREATE TABLE IF NOT EXISTS capacity_ledger (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  delta INTEGER NOT NULL,
  reason TEXT NOT NULL,
  customer_id TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_capacity_account ON capacity_ledger(account_id, created_at);

CREATE TABLE IF NOT EXISTS capacity_rules (
  rule_id TEXT PRIMARY KEY,
  apply_roles TEXT NOT NULL DEFAULT '',
  total_limit INTEGER NOT NULL,
  rule_type INTEGER,
  cust_state INTEGER,
  use_flag INTEGER NOT NULL DEFAULT 1,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS seas_rules (
  rule_id TEXT PRIMARY KEY,
  rule_name TEXT,
  apply_roles TEXT NOT NULL DEFAULT '',
  limit_days INTEGER,
  cust_scope INTEGER,
  in_type INTEGER,
  raw_json TEXT,
  fetched_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS dedup_snapshots (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  keywords TEXT NOT NULL,
  keywords_hash TEXT NOT NULL,
  module_code TEXT NOT NULL DEFAULT 'NewBF001',
  hit_count INTEGER NOT NULL,
  hits_json TEXT,
  checked_at TEXT NOT NULL,
  checked_by_account TEXT,
  UNIQUE(keywords_hash, module_code)
);

CREATE TABLE IF NOT EXISTS customs_cache_entries (
  cache_key TEXT PRIMARY KEY,
  query_type TEXT NOT NULL,
  params_hash TEXT NOT NULL,
  params_json TEXT NOT NULL,
  page_index INTEGER NOT NULL DEFAULT 1,
  page_size INTEGER NOT NULL DEFAULT 20,
  permission_scope TEXT NOT NULL,
  result_json BLOB,
  result_encoding TEXT NOT NULL DEFAULT 'gzip',
  result_bytes INTEGER,
  total_num INTEGER,
  upstream_version TEXT,
  fetched_at TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  stale INTEGER NOT NULL DEFAULT 0,
  hit_count INTEGER NOT NULL DEFAULT 0,
  last_used_at TEXT,
  last_error TEXT
);
CREATE INDEX IF NOT EXISTS idx_customs_cache_expires ON customs_cache_entries(expires_at);
CREATE INDEX IF NOT EXISTS idx_customs_cache_used ON customs_cache_entries(last_used_at);
CREATE INDEX IF NOT EXISTS idx_customs_cache_type ON customs_cache_entries(query_type, params_hash);

CREATE TABLE IF NOT EXISTS customs_cache_meta (
  k TEXT PRIMARY KEY,
  v TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id TEXT PRIMARY KEY,
  type TEXT NOT NULL,
  params_json TEXT NOT NULL,
  idempotency_key TEXT,
  status TEXT NOT NULL,
  progress_done INTEGER NOT NULL DEFAULT 0,
  progress_total INTEGER NOT NULL DEFAULT 0,
  result_json TEXT, error TEXT,
  account_id TEXT,
  created_at TEXT NOT NULL, started_at TEXT, finished_at TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_tasks_idem ON tasks(idempotency_key) WHERE idempotency_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tasks_status ON tasks(status, created_at);

CREATE TABLE IF NOT EXISTS task_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  task_id TEXT NOT NULL,
  item_index INTEGER NOT NULL,
  item_key TEXT,
  status TEXT NOT NULL,
  result_json TEXT, error TEXT,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_task_items ON task_items(task_id, status);

CREATE TABLE IF NOT EXISTS sync_outbox (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  idempotency_key TEXT NOT NULL,
  entity_type TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  account_id TEXT NOT NULL,
  action TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  attempts INTEGER NOT NULL DEFAULT 0,
  next_retry_at TEXT,
  last_error TEXT,
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  UNIQUE(idempotency_key)
);
CREATE INDEX IF NOT EXISTS idx_outbox_status ON sync_outbox(status, next_retry_at);

CREATE TABLE IF NOT EXISTS reconcile_runs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  scope TEXT NOT NULL,
  account_id TEXT,
  started_at TEXT NOT NULL, finished_at TEXT,
  status TEXT NOT NULL, stats_json TEXT, error TEXT
);
CREATE TABLE IF NOT EXISTS reconcile_diffs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  run_id INTEGER NOT NULL,
  entity_type TEXT NOT NULL, entity_id TEXT,
  field TEXT, local_value TEXT, upstream_value TEXT,
  resolution TEXT,
  resolved_at TEXT, created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS events (
  event_id TEXT PRIMARY KEY,
  seq INTEGER NOT NULL,
  type TEXT NOT NULL,
  schema_version TEXT NOT NULL DEFAULT '1',
  account_id TEXT,
  entity_type TEXT, entity_id TEXT,
  payload_json TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  published_at TEXT
);
CREATE INDEX IF NOT EXISTS idx_events_seq ON events(seq);
CREATE INDEX IF NOT EXISTS idx_events_type ON events(type, occurred_at);

CREATE TABLE IF NOT EXISTS event_subscriptions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  url TEXT NOT NULL,
  secret_enc TEXT NOT NULL,
  event_types_json TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS session_health (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  account_id TEXT NOT NULL,
  checked_at TEXT NOT NULL,
  ok INTEGER NOT NULL,
  latency_ms INTEGER,
  error TEXT
);
CREATE INDEX IF NOT EXISTS idx_session_health ON session_health(account_id, checked_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor TEXT,
  action TEXT NOT NULL,
  account_id TEXT, entity_type TEXT, entity_id TEXT,
  detail_json TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_created ON audit_log(created_at);
`
  },
  {
    version: 2,
    name: 'customers_upstream_id',
    sql: `
ALTER TABLE customers ADD COLUMN upstream_id TEXT;
CREATE INDEX IF NOT EXISTS idx_customers_upstream ON customers(upstream_id);
`
  }
];

let sqliteWarned = false;

export class Store {
  readonly dbFile: string;
  private db: DatabaseSync | null = null;
  private txDepth = 0;
  private readonly stmtCache = new Map<string, ReturnType<DatabaseSync['prepare']>>();

  constructor(dbFile: string) {
    this.dbFile = dbFile;
  }

  open(): void {
    if (this.db) return;
    mkdirSync(dirname(this.dbFile), { recursive: true, mode: 0o700 });
    this.db = new DatabaseSync(this.dbFile);
    this.db.exec('PRAGMA journal_mode = WAL;');
    this.db.exec('PRAGMA synchronous = NORMAL;');
    this.db.exec('PRAGMA busy_timeout = 5000;');
    this.db.exec('PRAGMA cache_size = -65536;');
    this.db.exec('PRAGMA temp_store = MEMORY;');
    this.db.exec('PRAGMA mmap_size = 268435456;');
    this.db.exec('PRAGMA foreign_keys = ON;');
    this.migrate();
    if (!sqliteWarned && process.execArgv.every((a) => a !== '--experimental-sqlite')) {
      // 不主动打印警告，避免污染 CLI 输出；由启动脚本负责传 flag
      sqliteWarned = true;
    }
  }

  get raw(): DatabaseSync {
    if (!this.db) this.open();
    return this.db as DatabaseSync;
  }

  private migrate(): void {
    const db = this.raw;
    db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (version INTEGER PRIMARY KEY, name TEXT NOT NULL, applied_at TEXT NOT NULL);`);
    const applied = new Set<number>(
      (db.prepare('SELECT version FROM schema_migrations').all() as Array<{ version: number }>).map((r) => Number(r.version))
    );
    for (const m of MIGRATIONS) {
      if (applied.has(m.version)) continue;
      db.exec('BEGIN IMMEDIATE');
      try {
        db.exec(m.sql);
        db.prepare('INSERT INTO schema_migrations(version,name,applied_at) VALUES(?,?,?)').run(m.version, m.name, new Date().toISOString());
        db.exec('COMMIT');
      } catch (err) {
        try { db.exec('ROLLBACK'); } catch { /* ignore */ }
        throw err;
      }
    }
  }

  tx<T>(fn: () => T): T {
    if (this.txDepth > 0) {
      this.txDepth++;
      try { return fn(); } finally { this.txDepth--; }
    }
    this.raw.exec('BEGIN IMMEDIATE');
    this.txDepth = 1;
    try {
      const result = fn();
      this.raw.exec('COMMIT');
      return result;
    } catch (err) {
      try { this.raw.exec('ROLLBACK'); } catch { /* ignore */ }
      throw err;
    } finally {
      this.txDepth = 0;
    }
  }

  get<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T | undefined {
    const stmt = this.stmt(sql);
    return stmt.get(...(params as never[])) as T | undefined;
  }

  all<T = Record<string, unknown>>(sql: string, ...params: unknown[]): T[] {
    const stmt = this.stmt(sql);
    return stmt.all(...(params as never[])) as T[];
  }

  run(sql: string, ...params: unknown[]): { changes: number; lastInsertRowid: number | bigint } {
    const stmt = this.stmt(sql);
    return stmt.run(...(params as never[])) as { changes: number; lastInsertRowid: number | bigint };
  }

  exec(sql: string): void {
    this.raw.exec(sql);
  }

  private stmt(sql: string) {
    let s = this.stmtCache.get(sql);
    if (!s) {
      s = this.raw.prepare(sql);
      this.stmtCache.set(sql, s);
    }
    return s;
  }

  setKv(k: string, v: unknown): void {
    const now = new Date().toISOString();
    this.run(
      'INSERT INTO kv_config(k,v,updated_at) VALUES(?,?,?) ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at',
      k, JSON.stringify(v), now
    );
  }

  getKv<T = unknown>(k: string): T | undefined {
    const row = this.get<{ v: string }>('SELECT v FROM kv_config WHERE k=?', k);
    if (!row) return undefined;
    try { return JSON.parse(row.v) as T; } catch { return undefined; }
  }

  close(): void {
    this.stmtCache.clear();
    if (this.db) {
      try { this.db.close(); } catch { /* ignore */ }
      this.db = null;
    }
  }

  /** 备份（VACUUM INTO） */
  backup(targetFile: string): void {
    this.raw.exec(`VACUUM INTO '${targetFile.replaceAll("'", "''")}'`);
  }
}

export function openStore(dbFile: string): Store {
  const store = new Store(dbFile);
  store.open();
  return store;
}

export const SCHEMA_VERSION = MIGRATIONS[MIGRATIONS.length - 1].version;
