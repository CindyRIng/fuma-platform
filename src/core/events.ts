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
