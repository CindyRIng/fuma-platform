import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { publishEvent, purgeEvents } from '../../src/core/events.js';

describe('events', () => {
  it('按时间/类型归档并清理历史事件', () => {
    const home = mkdtempSync(join(tmpdir(), 'fuma-events-'));
    const rt = createRuntime({ home, silentConsole: true });
    publishEvent(rt, { type: 'sync.conflict', accountId: 'acct_01', entityType: 'customer', entityId: 'C1', payload: { a: 1 } });
    publishEvent(rt, { type: 'customer.synced', accountId: 'acct_01', entityType: 'customer', entityId: 'C1', payload: {} });
    rt.store.run(
      `INSERT INTO events(event_id,seq,type,schema_version,account_id,entity_type,entity_id,payload_json,occurred_at)
       VALUES(?,?,?,?,?,?,?,?,?)`,
      'evt_old', 9999, 'sync.conflict', '1', 'acct_01', 'customer', 'C0', '{}', '2020-01-01T00:00:00.000Z'
    );
    const archive = join(home, 'events.jsonl');
    const result = purgeEvents(rt, { olderThanDays: 30, types: 'sync.conflict', archive });
    expect(result.deleted).toBe(1);
    expect(result.archived).toBe(1);
    expect(rt.store.get<{ c: number }>('SELECT COUNT(*) c FROM events')?.c).toBe(2);
    const remaining = rt.store.all<{ type: string }>('SELECT type FROM events ORDER BY seq');
    expect(remaining.map((r) => r.type)).toEqual(['sync.conflict', 'customer.synced']);
    rt.close();
  });

  it('dryRun 只统计不删除', () => {
    const home = mkdtempSync(join(tmpdir(), 'fuma-events-dry-'));
    const rt = createRuntime({ home, silentConsole: true });
    publishEvent(rt, { type: 'sync.conflict', payload: {} });
    const result = purgeEvents(rt, { olderThanDays: 0, types: 'sync.conflict', dryRun: true });
    expect(result.deleted).toBe(0);
    expect(result.archived).toBe(0);
    expect(rt.store.get<{ c: number }>('SELECT COUNT(*) c FROM events')?.c).toBe(1);
    rt.close();
  });
});
