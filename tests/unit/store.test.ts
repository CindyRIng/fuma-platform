import { describe, expect, it } from 'vitest';
import { existsSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { openStore, SCHEMA_VERSION } from '../../src/core/store.js';

function tempDb(): string {
  return join(mkdtempSync(join(tmpdir(), 'fuma-db-')), 'fuma.db');
}

describe('Store', () => {
  it('初始化迁移并记录 schema 版本', () => {
    const store = openStore(tempDb());
    const row = store.get<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations');
    expect(Number(row?.c)).toBeGreaterThan(0);
    expect(SCHEMA_VERSION).toBeGreaterThanOrEqual(1);
    const tables = store.all<{ name: string }>("SELECT name FROM sqlite_master WHERE type='table'");
    const names = tables.map((t) => t.name);
    expect(names).toContain('accounts');
    expect(names).toContain('sessions');
    expect(names).toContain('customers');
    expect(names).toContain('customs_cache_entries');
    expect(names).toContain('events');
    store.close();
  });

  it('open 幂等（重复打开不重复迁移）', () => {
    const db = tempDb();
    const a = openStore(db);
    a.close();
    const b = openStore(db);
    const row = b.get<{ c: number }>('SELECT COUNT(*) AS c FROM schema_migrations');
    expect(Number(row?.c)).toBe(SCHEMA_VERSION);
    b.close();
  });

  it('事务失败回滚', () => {
    const store = openStore(tempDb());
    store.setKv('k1', 'v1');
    expect(() => store.tx(() => {
      store.run('INSERT INTO kv_config(k,v,updated_at) VALUES(?,?,?)', 'k2', 'v2', 'now');
      throw new Error('rollback');
    })).toThrow('rollback');
    expect(store.getKv('k1')).toBe('v1');
    expect(store.getKv('k2')).toBeUndefined();
    store.close();
  });

  it('kv 存取与备份', () => {
    const store = openStore(tempDb());
    store.setKv('a', { b: 1 });
    expect(store.getKv('a')).toEqual({ b: 1 });
    const target = tempDb();
    store.backup(target);
    expect(existsSync(target)).toBe(true);
    store.close();
  });
});
