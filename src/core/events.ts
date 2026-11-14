import { writeFileSync } from 'node:fs';
import { AppError } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import type { Runtime } from '../services/runtime.js';

export interface DomainEvent {
  eventId: string;
  seq: number;
  type: string;
  schemaVersion: string;
  accountId: string | null;
  entityType: string | null;
  entityId: string | null;
  payload: Record<string, unknown>;
  occurredAt: string;
  publishedAt: string | null;
}

let seqCounter: number | null = null;

function nextSeq(rt: Runtime): number {
  if (seqCounter === null) {
    const row = rt.store.get<{ m: number }>('SELECT COALESCE(MAX(seq),0) AS m FROM events');
    seqCounter = Number(row?.m ?? 0);
  }
  seqCounter += 1;
  return seqCounter;
}

/** 在本地事务内写事件（outbox 语义：状态变更必有事件）。 */
export function publishEvent(rt: Runtime, input: {
  type: string;
  accountId?: string | null;
  entityType?: string | null;
  entityId?: string | null;
  payload?: Record<string, unknown>;
}): string {
  const eventId = `evt_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
  const seq = nextSeq(rt);
  const occurredAt = nowIso();
  rt.store.run(
    `INSERT INTO events(event_id,seq,type,schema_version,account_id,entity_type,entity_id,payload_json,occurred_at) VALUES(?,?,?,?,?,?,?,?,?)`,
    eventId, seq, input.type, '1', input.accountId ?? null, input.entityType ?? null, input.entityId ?? null,
    JSON.stringify(input.payload ?? {}), occurredAt
  );
  return eventId;
}

export interface ListEventsInput {
  sinceSeq?: number | string;
  limit?: number | string;
  type?: string;
  accountId?: string;
}

export function listEvents(rt: Runtime, input: ListEventsInput = {}): { events: DomainEvent[]; nextSeq: number } {
  const since = Math.max(0, Number(input.sinceSeq ?? 0) || 0);
  const limit = Math.min(500, Math.max(1, Number(input.limit ?? 100) || 100));
  const where = ['seq > ?'];
  const params: unknown[] = [since];
  if (input.type) { where.push('type = ?'); params.push(input.type); }
  if (input.accountId) { where.push('account_id = ?'); params.push(input.accountId); }
  const rows = rt.store.all<Record<string, unknown>>(
    `SELECT * FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC LIMIT ?`, ...params, limit
  );
  const events = rows.map((r) => ({
    eventId: String(r.event_id),
    seq: Number(r.seq),
    type: String(r.type),
    schemaVersion: String(r.schema_version),
    accountId: (r.account_id as string | null) ?? null,
    entityType: (r.entity_type as string | null) ?? null,
    entityId: (r.entity_id as string | null) ?? null,
    payload: JSON.parse(String(r.payload_json ?? '{}')) as Record<string, unknown>,
    occurredAt: String(r.occurred_at),
    publishedAt: (r.published_at as string | null) ?? null
  }));
  return { events, nextSeq: events.length ? events[events.length - 1].seq : since };
}

export function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v.length === 0) throw new AppError('invalid_argument', `缺少参数 ${key}`);
  return v;
}

export interface PurgeEventsInput {
  /** 删除早于 N 天的事件（0=删除全部早于当前时刻的事件；不传且无 before 时默认 30） */
  olderThanDays?: number | string;
  /** 绝对截止时间（ISO），优先于 olderThanDays */
  before?: string;
  /** 事件类型过滤，逗号分隔（如 sync.conflict） */
  types?: string;
  /** 仅统计不删除 */
  dryRun?: boolean;
  /** 归档文件路径（JSONL）；指定后在删除前写入 */
  archive?: string;
}

export interface PurgeEventsResult {
  deleted: number;
  archived: number;
  cutoff: string;
  types: string[];
  archive: string | null;
  dryRun: boolean;
}

/** 归档/清理历史事件（默认按事件类型/时间删除，可先写 JSONL 归档）。 */
export function purgeEvents(rt: Runtime, input: PurgeEventsInput = {}): PurgeEventsResult {
  const dryRun = input.dryRun === true;
  const days = input.olderThanDays === undefined || input.olderThanDays === '' ? 30 : Number(input.olderThanDays);
  if (!Number.isFinite(days) || days < 0) throw new AppError('invalid_argument', 'olderThanDays 必须 ≥ 0');
  const cutoff = input.before
    ? new Date(input.before).toISOString()
    : new Date(Date.now() - days * 86_400_000).toISOString();
  if (Number.isNaN(Date.parse(cutoff))) throw new AppError('invalid_argument', 'before 需为合法 ISO 时间');
  const types = (input.types ?? '').split(',').map((t) => t.trim()).filter(Boolean);
  const where = ['occurred_at < ?'];
  const params: unknown[] = [cutoff];
  if (types.length) {
    where.push(`type IN (${types.map(() => '?').join(',')})`);
    params.push(...types);
  }
  const rows = rt.store.all<Record<string, unknown>>(
    `SELECT seq,event_id,type,account_id,entity_type,entity_id,payload_json,occurred_at FROM events WHERE ${where.join(' AND ')} ORDER BY seq ASC`,
    ...params
  );
  let archived = 0;
  if (input.archive && rows.length) {
    const lines = rows.map((r) => JSON.stringify({
      seq: Number(r.seq), eventId: String(r.event_id), type: String(r.type),
      accountId: r.account_id ?? null, entityType: r.entity_type ?? null, entityId: r.entity_id ?? null,
      payload: JSON.parse(String(r.payload_json ?? '{}')), occurredAt: String(r.occurred_at)
    }));
    writeFileSync(input.archive, lines.join('\n') + '\n', { mode: 0o600 });
    archived = rows.length;
  }
  let deleted = 0;
  if (!dryRun && rows.length) {
    const seqs = rows.map((r) => Number(r.seq));
    rt.store.tx(() => {
      for (let i = 0; i < seqs.length; i += 500) {
        const chunk = seqs.slice(i, i + 500);
        rt.store.run(`DELETE FROM events WHERE seq IN (${chunk.map(() => '?').join(',')})`, ...chunk);
        deleted += chunk.length;
      }
    });
  }
  return { deleted: dryRun ? 0 : deleted, archived, cutoff, types, archive: input.archive ?? null, dryRun };
}
