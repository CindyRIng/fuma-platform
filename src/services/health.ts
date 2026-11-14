import { VERSION, SPEC_VERSION } from '../version.js';
import { listAccounts } from './accounts.js';
import type { Runtime } from './runtime.js';

export interface HealthView {
  status: 'ok' | 'degraded';
  version: string;
  specVersion: string;
  uptimeSeconds: number;
  db: 'ok' | 'error';
  schemaVersion: number | null;
  accounts: number;
  onlineAccounts: number;
  pid: number;
  now: string;
}

const startedAt = Date.now();

export function healthView(rt: Runtime): HealthView {
  let db: 'ok' | 'error' = 'ok';
  let schemaVersion: number | null = null;
  try {
    const row = rt.store.get<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations');
    schemaVersion = row ? Number(row.c) : null;
  } catch {
    db = 'error';
  }
  let accounts: ReturnType<typeof listAccounts> = [];
  try { accounts = listAccounts(rt); } catch { /* ignore */ }
  const online = accounts.filter((a) => a.status === 'active').length;
  return {
    status: db === 'ok' ? 'ok' : 'degraded',
    version: VERSION,
    specVersion: SPEC_VERSION,
    uptimeSeconds: Math.floor((Date.now() - startedAt) / 1000),
    db,
    schemaVersion,
    accounts: accounts.length,
    onlineAccounts: online,
    pid: process.pid,
    now: new Date().toISOString()
  };
}

export interface StatusView extends HealthView {
  accountsDetail: Array<{ accountId: string; name: string; status: string; ownerName: string | null }>;
  pool: Record<string, unknown>;
  sync: Record<string, unknown>;
  tasks: Record<string, number>;
}

export function statusView(rt: Runtime): StatusView {
  const health = healthView(rt);
  const accounts = listAccounts(rt);
  const counts = rt.store.all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM tasks GROUP BY status');
  const tasks: Record<string, number> = {};
  for (const c of counts) tasks[String(c.status)] = Number(c.c);
  const outbox = rt.store.all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM sync_outbox GROUP BY status');
  const sync: Record<string, number> = {};
  for (const o of outbox) sync[String(o.status)] = Number(o.c);
  return {
    ...health,
    accountsDetail: accounts.map((a) => ({ accountId: a.accountId, name: a.name, status: a.status, ownerName: a.ownerName })),
    pool: {},
    sync,
    tasks
  };
}
