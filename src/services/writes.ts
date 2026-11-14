import { AppError } from '../core/errors.js';
import { publishEvent } from '../core/events.js';
import { newId, newSecret } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import type { Runtime } from '../services/runtime.js';
import { getAccount } from '../services/accounts.js';
import { getCustomer, upsertCustomer } from '../services/customers.js';
import { checkCapacity, recordCapacity, validateClaim, validateCreate } from '../rules/engine.js';
import { toStr } from '../services/mappers.js';

export interface WriteResult {
  customerId?: string;
  contactId?: string;
  followupId?: string;
  accountId: string;
  syncState: string;
  outboxId: number | null;
  eventIds: string[];
}

function idemKey(input: Record<string, unknown>): string {
  return typeof input.idempotencyKey === 'string' && input.idempotencyKey ? input.idempotencyKey : newSecret(12);
}

function existingByKey(rt: Runtime, key: string): Record<string, unknown> | undefined {
  return rt.store.get<Record<string, unknown>>('SELECT * FROM sync_outbox WHERE idempotency_key=?', key);
}

interface OutboxEnqueue {
  idempotencyKey: string;
  entityType: string;
  entityId: string;
  accountId: string;
  action: string;
  payload: Record<string, unknown>;
}

function enqueueOutbox(rt: Runtime, op: OutboxEnqueue): number | null {
  const existing = existingByKey(rt, op.idempotencyKey);
  if (existing) {
    return existing.id !== undefined ? Number(existing.id) : null;
  }
  const now = nowIso();
  const r = rt.store.run(
    `INSERT INTO sync_outbox(idempotency_key,entity_type,entity_id,account_id,action,payload_json,status,attempts,created_at,updated_at)
     VALUES(?,?,?,?,?,?,'pending',0,?,?)`,
    op.idempotencyKey, op.entityType, op.entityId, op.accountId, op.action, JSON.stringify(op.payload), now, now
  );
  return Number(r.lastInsertRowid);
}

/* ---------------- 领取 ---------------- */
export interface ClaimInput {
  accountId: string;
  customerId: string;
  idempotencyKey?: string;
}

export async function claim(rt: Runtime, input: ClaimInput): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  const customerId = String(input.customerId ?? '');
  if (!customerId) throw new AppError('invalid_argument', 'customerId 必填');
  const key = idemKey(input as unknown as Record<string, unknown>);
  const existing = existingByKey(rt, key);
  if (existing) {
    return { customerId: String(existing.entity_id), accountId: String(existing.account_id), syncState: String(existing.status) === 'succeeded' ? 'synced' : 'pending', outboxId: Number(existing.id), eventIds: [] };
  }
  getAccount(rt, accountId);
  const v = await validateClaim(rt, accountId, customerId);
  if (!v.ok) {
    const code = v.reason === 'capacity_exceeded' ? 'capacity_exceeded'
      : v.reason === 'cooldown_active' ? 'cooldown_active'
      : v.reason === 'duplicate_customer' ? 'duplicate_customer'
      : v.reason === 'session_expired' ? 'session_expired'
      : v.reason === 'not_in_open_sea' ? 'conflict'
      : 'conflict';
    throw new AppError(code, `领取校验失败: ${v.reason}`, { details: v.details });
  }
  const custName = v.customer?.custName ?? '';
  const eventIds: string[] = [];
  let outboxId: number | null = null;
  rt.store.tx(() => {
    const now = nowIso();
    upsertCustomer(rt, {
      customerId, accountId, cId: rt.config.upstream.companyId, custName, custShortName: '',
      billCode: '', ownerCtId: null, ownerDeptKey: null, seasFlag: 0, custLevel: null, custSource: null,
      custState: null, countryId: null, tel: '', mobile: '', web: '', creditCode: '', sourceType: null,
      createDate: '', modifyDate: '', willInSeaDate: null, lastTrackInfo: '', contName: '',
      contactNum: null, location: '', remarks: ''
    });
    rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', 'pending', now, customerId);
    recordCapacity(rt, accountId, 1, 'claim', customerId);
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'customer', entityId: customerId, accountId, action: 'claim',
      payload: { customerId, custName }
    });
    eventIds.push(publishEvent(rt, { type: 'open_sea.claimed', accountId, entityType: 'customer', entityId: customerId, payload: { customerId, accountId, syncState: 'pending' } }));
  });
  return { customerId, accountId, syncState: 'pending', outboxId, eventIds };
}

/* ---------------- 释放 ---------------- */
export async function release(rt: Runtime, input: { accountId: string; customerId: string; reason?: string; idempotencyKey?: string }): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  const customerId = String(input.customerId ?? '');
  if (!customerId) throw new AppError('invalid_argument', 'customerId 必填');
  const key = idemKey(input as unknown as Record<string, unknown>);
  if (existingByKey(rt, key)) {
    return { customerId, accountId, syncState: 'pending', outboxId: null, eventIds: [] };
  }
  const local = rt.store.get<Record<string, unknown>>('SELECT * FROM customers WHERE customer_id=?', customerId);
  if (local && Number(local.seas_flag) === 1) throw new AppError('conflict', '客户已在公海');
  const eventIds: string[] = [];
  let outboxId: number | null = null;
  rt.store.tx(() => {
    const now = nowIso();
    if (local) {
      rt.store.run('UPDATE customers SET seas_flag=1, sync_state=?, released_at=?, updated_at=? WHERE customer_id=?', 'pending', now, customerId);
    } else {
      rt.store.run(
        `INSERT INTO customers(customer_id,account_id,seas_flag,sync_state,released_at,created_at,updated_at) VALUES(?,?,1,?,?,?,?)`,
        customerId, accountId, 'pending', now, now
      );
    }
    recordCapacity(rt, accountId, -1, 'release', customerId);
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'customer', entityId: customerId, accountId, action: 'release',
      payload: { customerId, reason: input.reason ?? '' }
    });
    eventIds.push(publishEvent(rt, { type: 'open_sea.released', accountId, entityType: 'customer', entityId: customerId, payload: { customerId, accountId, reason: input.reason ?? null, syncState: 'pending' } }));
  });
  return { customerId, accountId, syncState: 'pending', outboxId, eventIds };
}

/* ---------------- 建档 ---------------- */
export interface CreateCustomerInput {
  accountId: string;
  data: Record<string, unknown>;
  idempotencyKey?: string;
}

export async function createCustomer(rt: Runtime, input: CreateCustomerInput): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  const data = input.data ?? {};
  if (!data.custName) throw new AppError('invalid_argument', '客户名称（custName）必填');
  const check = await validateCreate(rt, accountId);
  if (!check.ok) throw new AppError(check.reason === 'capacity_exceeded' ? 'capacity_exceeded' : 'conflict', `建档校验失败: ${check.reason}`, { details: check.details });
  const key = idemKey(input as unknown as Record<string, unknown>);
  if (existingByKey(rt, key)) {
    return { customerId: '', accountId, syncState: 'pending', outboxId: null, eventIds: [] };
  }
  const localId = newId('local');
  const eventIds: string[] = [];
  let outboxId: number | null = null;
  rt.store.tx(() => {
    upsertCustomer(rt, {
      customerId: localId, accountId, cId: rt.config.upstream.companyId,
      custName: toStr(data.custName), custShortName: toStr(data.custShortName ?? data.custName),
      billCode: '', ownerCtId: null, ownerDeptKey: null, seasFlag: 0, custLevel: null, custSource: null,
      custState: null, countryId: null, tel: toStr(data.tel), mobile: toStr(data.mobile), web: toStr(data.web),
      creditCode: toStr(data.creditCodeEx), sourceType: null, createDate: '', modifyDate: '',
      willInSeaDate: null, lastTrackInfo: '', contName: '', contactNum: null, location: '', remarks: toStr(data.remarks)
    });
    rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', 'pending', nowIso(), localId);
    recordCapacity(rt, accountId, 1, 'create', localId);
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'customer', entityId: localId, accountId, action: 'create',
      payload: { master: data }
    });
    eventIds.push(publishEvent(rt, { type: 'customer.created', accountId, entityType: 'customer', entityId: localId, payload: { customerId: localId, accountId, syncState: 'pending' } }));
  });
  return { customerId: localId, accountId, syncState: 'pending', outboxId, eventIds };
}

/* ---------------- 编辑 ---------------- */
export async function updateCustomer(rt: Runtime, input: { accountId: string; customerId: string; data: Record<string, unknown>; idempotencyKey?: string }): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  const customerId = String(input.customerId ?? '');
  if (!customerId) throw new AppError('invalid_argument', 'customerId 必填');
  const key = idemKey(input as unknown as Record<string, unknown>);
  if (existingByKey(rt, key)) return { customerId, accountId, syncState: 'pending', outboxId: null, eventIds: [] };
  const eventIds: string[] = [];
  let outboxId: number | null = null;
  rt.store.tx(() => {
    const now = nowIso();
    const local = rt.store.get<Record<string, unknown>>('SELECT * FROM customers WHERE customer_id=?', customerId);
    if (local?.raw_json) {
      try {
        const raw = JSON.parse(String(local.raw_json)) as Record<string, unknown>;
        rt.store.run('UPDATE customers SET raw_json=?, cust_name=?, sync_state=?, updated_at=? WHERE customer_id=?',
          JSON.stringify({ ...raw, ...input.data }), toStr(input.data.custName ?? local.cust_name), 'pending', now, customerId);
      } catch {
        rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', 'pending', now, customerId);
      }
    } else {
      rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', 'pending', now, customerId);
    }
    const upstream = (rt.store.get<{ upstream_id: string | null }>('SELECT upstream_id FROM customers WHERE customer_id=?', customerId)?.upstream_id) ?? customerId;
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'customer', entityId: customerId, accountId, action: 'update',
      payload: { customerId, upstreamId: upstream, master: input.data }
    });
    eventIds.push(publishEvent(rt, { type: 'customer.updated', accountId, entityType: 'customer', entityId: customerId, payload: { customerId, accountId, changedFields: Object.keys(input.data) } }));
  });
  return { customerId, accountId, syncState: 'pending', outboxId, eventIds };
}

/* ---------------- 删除（软删进回收站） ---------------- */
export async function deleteCustomer(rt: Runtime, input: { accountId: string; customerId: string; idempotencyKey?: string }): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  const customerId = String(input.customerId ?? '');
  if (!customerId) throw new AppError('invalid_argument', 'customerId 必填');
  const key = idemKey(input as unknown as Record<string, unknown>);
  if (existingByKey(rt, key)) return { customerId, accountId, syncState: 'pending', outboxId: null, eventIds: [] };
  let outboxId: number | null = null;
  rt.store.tx(() => {
    rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', 'pending', nowIso(), customerId);
    const upstream = (rt.store.get<{ upstream_id: string | null }>('SELECT upstream_id FROM customers WHERE customer_id=?', customerId)?.upstream_id) ?? customerId;
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'customer', entityId: customerId, accountId, action: 'delete',
      payload: { customerId, upstreamId: upstream }
    });
  });
  return { customerId, accountId, syncState: 'pending', outboxId, eventIds: [] };
}

/* ---------------- 跟进 ---------------- */
export async function createFollowup(rt: Runtime, input: { accountId: string; customerId: string; content: string; method?: string; followedAt?: string; nextFollowupAt?: string; contactId?: string; idempotencyKey?: string }): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  if (!input.customerId) throw new AppError('invalid_argument', 'customerId 必填');
  if (!input.content) throw new AppError('invalid_argument', '跟进内容（content）必填');
  const key = idemKey(input as unknown as Record<string, unknown>);
  if (existingByKey(rt, key)) return { followupId: '', accountId, syncState: 'pending', outboxId: null, eventIds: [] };
  const followupId = newId('follow');
  const followedAt = input.followedAt ?? nowIso();
  const eventIds: string[] = [];
  let outboxId: number | null = null;
  rt.store.tx(() => {
    rt.store.run(
      `INSERT INTO followups(followup_id,customer_id,contact_id,account_id,method,content,followed_at,next_followup_at,related_module,related_id,sync_state,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      followupId, input.customerId, input.contactId ?? null, accountId, input.method ?? '', input.content,
      followedAt, input.nextFollowupAt ?? null, 'NewBF004', followupId, 'pending', nowIso(), nowIso()
    );
    const willInSea = new Date(Date.parse(followedAt) + rt.config.rules.protectionDays * 86_400_000).toISOString();
    rt.store.run('UPDATE customers SET last_track_at=?, will_in_sea_at=?, updated_at=? WHERE customer_id=?', followedAt, willInSea, nowIso(), input.customerId);
    const upstream = (rt.store.get<{ upstream_id: string | null }>('SELECT upstream_id FROM customers WHERE customer_id=?', input.customerId)?.upstream_id) ?? input.customerId;
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'followup', entityId: followupId, accountId, action: 'followup.add',
      payload: { customerId: input.customerId, upstreamId: upstream, data: { trackContent: input.content, trackMode: input.method ?? '', trackDate: followedAt, nextTrackDate: input.nextFollowupAt ?? '' } }
    });
    eventIds.push(publishEvent(rt, { type: 'customer.updated', accountId, entityType: 'customer', entityId: input.customerId, payload: { customerId: input.customerId, accountId, changedFields: ['lastTrackAt', 'willInSeaAt'] } }));
  });
  return { followupId, accountId, syncState: 'pending', outboxId, eventIds };
}

/* ---------------- 联系人 ---------------- */
export async function createContact(rt: Runtime, input: { accountId: string; customerId: string; data: Record<string, unknown>; idempotencyKey?: string }): Promise<WriteResult> {
  const accountId = String(input.accountId ?? '');
  if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
  if (!input.customerId) throw new AppError('invalid_argument', 'customerId 必填');
  if (!input.data?.contName) throw new AppError('invalid_argument', '联系人姓名（contName）必填');
  const key = idemKey(input as unknown as Record<string, unknown>);
  if (existingByKey(rt, key)) return { contactId: '', accountId, syncState: 'pending', outboxId: null, eventIds: [] };
  const contactId = newId('contact');
  let outboxId: number | null = null;
  const eventIds: string[] = [];
  rt.store.tx(() => {
    rt.store.run(
      `INSERT INTO contacts(contact_id,customer_id,account_id,name,email,whatsapp,mobile,tel,position,sync_state,raw_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      contactId, input.customerId, accountId, toStr(input.data.contName), toStr(input.data.mailAddress), toStr(input.data.whatsapp),
      toStr(input.data.mobile), toStr(input.data.tel), toStr(input.data.jobs), 'pending', JSON.stringify(input.data), nowIso(), nowIso()
    );
    const upstream = (rt.store.get<{ upstream_id: string | null }>('SELECT upstream_id FROM customers WHERE customer_id=?', input.customerId)?.upstream_id) ?? input.customerId;
    outboxId = enqueueOutbox(rt, {
      idempotencyKey: key, entityType: 'contact', entityId: contactId, accountId, action: 'contact.add',
      payload: { customerId: input.customerId, upstreamId: upstream, data: input.data }
    });
    eventIds.push(publishEvent(rt, { type: 'customer.updated', accountId, entityType: 'customer', entityId: input.customerId, payload: { customerId: input.customerId, accountId, changedFields: ['contacts'] } }));
  });
  return { contactId, accountId, syncState: 'pending', outboxId, eventIds };
}

export interface SyncStatusView {
  outbox: Record<string, number>;
  pending: number;
  failed: number;
  dead: number;
  lastRunAt: string | null;
}

export function syncStatus(rt: Runtime): SyncStatusView {
  const rows = rt.store.all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM sync_outbox GROUP BY status');
  const outbox: Record<string, number> = {};
  for (const r of rows) outbox[r.status] = Number(r.c);
  const last = rt.store.getKv<{ at: string }>('sync:lastRun');
  return { outbox, pending: outbox.pending ?? 0, failed: outbox.failed ?? 0, dead: outbox.dead ?? 0, lastRunAt: last?.at ?? null };
}
