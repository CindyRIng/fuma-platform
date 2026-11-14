import { AppError } from '../core/errors.js';
import { publishEvent } from '../core/events.js';
import { nowIso } from '../core/time.js';
import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';
import { mapCustomer } from './mappers.js';
import { upsertCustomer } from './customers.js';

interface OwnerInfo { ctId: number | null; deptKey: number | null; ownerName: string | null }

async function ensureOwnerInfo(rt: Runtime, accountId: string): Promise<OwnerInfo> {
  const cached = rt.store.getKv<OwnerInfo>(`profile:${accountId}`);
  if (cached && cached.deptKey) return cached;
  const loaded = rt.sessions.loadTokens(accountId);
  if (!loaded) return { ctId: null, deptKey: null, ownerName: null };
  try {
    const data = await rt.upstream.call<Record<string, unknown>>(
      { accountId, tokens: loaded.tokens, logger: rt.logger },
      { method: 'GET', path: '/SystemSet/personaldata/accountIndividualInf', timeoutMs: 15000 }
    );
    const companies = (data?.companies ?? []) as Array<Record<string, unknown>>;
    const company = companies.find((c) => Number(c.cId) === rt.config.upstream.companyId) ?? companies[0];
    const depts = (company?.departments ?? []) as Array<Record<string, unknown>>;
    const info: OwnerInfo = {
      ctId: company?.ctId !== undefined ? Number(company.ctId) : loaded.ctId,
      deptKey: depts[0]?.dkey !== undefined ? Number(depts[0].dkey) : null,
      ownerName: typeof company?.nickName === 'string' ? company.nickName : null
    };
    rt.store.setKv(`profile:${accountId}`, info);
    return info;
  } catch {
    return { ctId: loaded.ctId, deptKey: null, ownerName: null };
  }
}

interface OutboxRow {
  id: number;
  idempotency_key: string;
  entity_type: string;
  entity_id: string;
  account_id: string;
  action: string;
  payload_json: string;
  status: string;
  attempts: number;
  next_retry_at: string | null;
}

function due(row: OutboxRow): boolean {
  return !row.next_retry_at || Date.parse(row.next_retry_at) <= Date.now();
}

function backoffMs(attempts: number): number {
  return Math.min(60_000, 1000 * 2 ** Math.min(attempts, 5));
}

async function executeAction(rt: Runtime, row: OutboxRow): Promise<{ upstreamId?: string | null }> {
  const payload = JSON.parse(row.payload_json) as Record<string, unknown>;
  const pool = poolOf(rt);
  return pool.runWrite(row.account_id, async (ctx) => {
    const call = (path: string, body: Record<string, unknown>) => rt.upstream.call(ctx.tokens ? { accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger } : { accountId: ctx.accountId, tokens: null }, {
      method: 'POST', path, body, timeoutMs: 30_000
    });
    switch (row.action) {
      case 'claim': {
        await call('/bill/customer/doBatchReceive', { moduleCode: 'NewBF001', optCode: 'otReceive', custIds: [String(payload.customerId ?? row.entity_id)] });
        return { upstreamId: null };
      }
      case 'release': {
        await call('/bill/customer/doBatchPutSeas', { moduleCode: 'NewBF001', optCode: 'otPutSeas', custIds: [String(payload.customerId ?? row.entity_id)], inSeaReason: String(payload.reason ?? '') });
        return { upstreamId: null };
      }
      case 'create': {
        const raw = (payload.master as Record<string, unknown>) ?? {};
        const loaded = rt.sessions.loadTokens(row.account_id);
        const ownerInfo = await ensureOwnerInfo(rt, row.account_id);
        const now = new Date();
        const pad = (n: number) => String(n).padStart(2, '0');
        const dateStr = `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())} ${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}`;
        const master: Record<string, unknown> = {
          custName: raw.custName, custShortName: raw.custShortName ?? raw.custName, creditCodeEx: '', multipleTitles: '',
          customint1: raw.customint1 ?? 1, custSource: raw.custSource ?? 120, custState: ' 1'.trim(), custLevel: raw.custLevel ?? 1,
          timeZone: ' 9'.trim(), custAreas: ' 10138'.trim(), countryId: ' 1'.trim(), sourceType: ' 3'.trim(), actualCreateDate: dateStr,
          ownerCtId: ownerInfo.ctId ?? loaded?.ctId ?? null, ownerDeptKey: ownerInfo.deptKey ?? '',
          ...raw
        };
        const data = await call('/bill/customer/addSingleCustomer', {
          cid: rt.config.upstream.companyId,
          moduleCode: 'NewBF001',
          customersMultipleTitlesList: [],
          submitApprovalRequest: { autoOperatorFlag: true, moduleCode: 'NewBF001', optCode: 'otNew' },
          master
        });
        let upstreamId: string | null = null;
        if (typeof data === 'string') upstreamId = data;
        else if (data && typeof data === 'object') {
          const d = data as Record<string, unknown>;
          upstreamId = d.key_id !== undefined ? String(d.key_id) : (d.keyId !== undefined ? String(d.keyId) : (d.custId !== undefined ? String(d.custId) : null));
        }
        return { upstreamId };
      }
      case 'update': {
        // 先取完整详情，合并 patch 后提交，避免必填校验失败
        const ownerInfo = await ensureOwnerInfo(rt, row.account_id);
        const upstreamId = String(payload.upstreamId ?? row.entity_id);
        let master: Record<string, unknown> = {};
        try {
          const detail = await rt.upstream.call<Array<Record<string, unknown>>>(ctx.tokens ? { accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger } : { accountId: ctx.accountId, tokens: null }, {
            method: 'POST', path: '/bill/bill/get_detail_info', body: { masterKeyId: upstreamId, moduleCode: 'NewBF001', structId: 1, desensitizeFlag: true }
          });
          master = (Array.isArray(detail) ? detail[0] : undefined) ?? {};
        } catch {
          master = {};
        }
        await call('/bill/customer/edit_customer', {
          cid: rt.config.upstream.companyId,
          moduleCode: 'NewBF001',
          customersMultipleTitlesList: [],
          submitApprovalRequest: { autoOperatorFlag: true, moduleCode: 'NewBF001', optCode: 'otEdit' },
          master: { ...master, ...(payload.master as Record<string, unknown>), key_id: upstreamId },
          opCtId: ownerInfo.ctId ?? undefined,
          opDeptKey: ownerInfo.deptKey ?? undefined,
          optCode: 'otEdit'
        });
        return { upstreamId };
      }
      case 'delete': {
        const upstreamId = String(payload.upstreamId ?? row.entity_id);
        await call('/bill/customer/doBatchDelete', { moduleCode: 'NewBF001', optCode: 'otDelete', custIds: [upstreamId] });
        return { upstreamId };
      }
      case 'followup.add': {
        const data = payload.data as Record<string, unknown>;
        await call('/bill/sub/add_sub', {
          moduleCode: 'NewBF004',
          masterKeyId: String(payload.upstreamId ?? payload.customerId ?? row.entity_id),
          data: { ...data, custId: String(payload.upstreamId ?? payload.customerId ?? row.entity_id) }
        });
        return { upstreamId: null };
      }
      case 'contact.add': {
        const data = payload.data as Record<string, unknown>;
        await call('/bill/sub/add_sub', {
          moduleCode: 'NewBF003',
          masterKeyId: String(payload.upstreamId ?? payload.customerId ?? row.entity_id),
          data: { ...data, custId: String(payload.upstreamId ?? payload.customerId ?? row.entity_id) }
        });
        return { upstreamId: null };
      }
      default:
        throw new AppError('not_implemented', `未知 outbox action: ${row.action}`);
    }
  });
}

function markEntitySynced(rt: Runtime, row: OutboxRow, upstreamId: string | null): void {
  const now = nowIso();
  if (row.entity_type === 'customer') {
    if (row.action === 'delete') {
      rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', 'deleted', now, row.entity_id);
    } else {
      rt.store.run('UPDATE customers SET sync_state=?, upstream_id=COALESCE(?, upstream_id), updated_at=? WHERE customer_id=?', 'synced', upstreamId, now, row.entity_id);
    }
    publishEvent(rt, { type: 'customer.synced', accountId: row.account_id, entityType: 'customer', entityId: row.entity_id, payload: { customerId: row.entity_id, accountId: row.account_id, upstreamId, action: row.action } });
  } else if (row.entity_type === 'followup') {
    rt.store.run('UPDATE followups SET sync_state=?, updated_at=? WHERE followup_id=?', 'synced', now, row.entity_id);
  } else if (row.entity_type === 'contact') {
    rt.store.run('UPDATE contacts SET sync_state=?, updated_at=? WHERE contact_id=?', 'synced', now, row.entity_id);
  }
}

/** 处理一批 outbox（同步 worker 单次执行），返回统计。 */
export async function processOutboxOnce(rt: Runtime, limit = 20): Promise<{ processed: number; succeeded: number; failed: number }> {
  const rows = rt.store.all<OutboxRow>(
    `SELECT * FROM sync_outbox WHERE status IN ('pending','failed') ORDER BY id ASC LIMIT ?`, limit * 3
  ).filter(due).slice(0, limit);
  let succeeded = 0;
  let failed = 0;
  for (const row of rows) {
    rt.store.run(`UPDATE sync_outbox SET status='running', attempts=attempts+1, updated_at=? WHERE id=?`, nowIso(), row.id);
    try {
      const result = await executeAction(rt, row);
      markEntitySynced(rt, row, result.upstreamId ?? null);
      rt.store.run(`UPDATE sync_outbox SET status='succeeded', last_error=NULL, updated_at=? WHERE id=?`, nowIso(), row.id);
      succeeded++;
    } catch (err) {
      const attempts = row.attempts + 1;
      const app = err instanceof AppError ? err : new AppError('upstream_error', err instanceof Error ? err.message : String(err));
      const status = attempts >= 5 ? 'dead' : 'failed';
      const next = status === 'failed' ? new Date(Date.now() + backoffMs(attempts)).toISOString() : null;
      rt.store.run(`UPDATE sync_outbox SET status=?, last_error=?, next_retry_at=?, updated_at=? WHERE id=?`, status, app.message.slice(0, 500), next, nowIso(), row.id);
      if (row.entity_type === 'customer') {
        rt.store.run('UPDATE customers SET sync_state=?, updated_at=? WHERE customer_id=?', status === 'dead' ? 'failed' : 'pending', nowIso(), row.entity_id);
        publishEvent(rt, { type: 'customer.sync_failed', accountId: row.account_id, entityType: 'customer', entityId: row.entity_id, payload: { customerId: row.entity_id, accountId: row.account_id, error: app.message.slice(0, 300), attempts } });
      }
      failed++;
    }
  }
  rt.store.setKv('sync:lastRun', { at: nowIso(), processed: rows.length, succeeded, failed });
  return { processed: rows.length, succeeded, failed };
}

export async function retryOutbox(rt: Runtime, outboxId: number): Promise<{ retried: boolean }> {
  const row = rt.store.get<OutboxRow>('SELECT * FROM sync_outbox WHERE id=?', outboxId);
  if (!row) throw new AppError('not_found', `outbox 不存在: ${outboxId}`);
  if (row.status === 'succeeded') throw new AppError('conflict', '该 outbox 已成功');
  rt.store.run(`UPDATE sync_outbox SET status='pending', next_retry_at=NULL, updated_at=? WHERE id=?`, nowIso(), outboxId);
  return { retried: true };
}

/* ---------------- 对账（customers scope） ---------------- */
export interface ReconcileReport {
  runId: number;
  scope: string;
  accountId: string | null;
  checked: number;
  diffs: number;
  status: string;
  startedAt: string;
  finishedAt: string;
}

interface UpstreamCustomerList {
  totalNum?: number;
  list?: Array<Record<string, unknown>>;
}

export async function reconcileCustomers(rt: Runtime, accountId?: string): Promise<ReconcileReport> {
  const startedAt = nowIso();
  const account = poolOf(rt).resolveReadAccount(accountId);
  const loaded = rt.sessions.loadTokens(account.accountId);
  const ctId = loaded?.ctId ?? null;
  const runRes = rt.store.run(
    `INSERT INTO reconcile_runs(scope,account_id,started_at,status) VALUES(?,?,?,'running')`,
    'customers', account.accountId, startedAt
  );
  const runId = Number(runRes.lastInsertRowid);
  let checked = 0;
  let diffs = 0;
  try {
    const body: Record<string, unknown> = {
      recoveryFlag: false,
      moduleCode: 'NewBF001',
      organizationStructure: { type: 3, ownerCtIdList: ctId ? [ctId] : [] },
      page: { from: 0, size: 200 },
      orderBy: { desc: 'desc', realFieldName: 'modify_date', tableCode: '1' }
    };
    const data = await rt.upstream.call<UpstreamCustomerList>({ accountId: account.accountId, tokens: account.tokens, logger: rt.logger }, {
      method: 'POST', path: '/bill/bill/get_page_list', body
    });
    const upstreamList = data.list ?? [];
    const localRows = new Map(rt.store.all<Record<string, unknown>>('SELECT * FROM customers WHERE account_id=?', account.accountId).map((r) => [String(r.customer_id), r]));
    for (const raw of upstreamList) {
      checked++;
      const view = mapCustomer(raw, account.accountId);
      const local = localRows.get(view.customerId);
      if (!local) {
        upsertCustomer(rt, view);
        continue;
      }
      const localSeas = Number(local.seas_flag ?? 0);
      const localOwner = local.owner_ct_id ? String(local.owner_ct_id) : null;
      const upstreamOwner = view.ownerCtId !== null ? String(view.ownerCtId) : null;
      const changes: Array<{ field: string; local: unknown; upstream: unknown }> = [];
      if (Number.isFinite(view.seasFlag) && localSeas !== view.seasFlag) changes.push({ field: 'seasFlag', local: localSeas, upstream: view.seasFlag });
      if (localOwner !== upstreamOwner) changes.push({ field: 'ownerCtId', local: localOwner, upstream: upstreamOwner });
      if (changes.length) {
        diffs += changes.length;
        for (const c of changes) {
          rt.store.run(
            `INSERT INTO reconcile_diffs(run_id,entity_type,entity_id,field,local_value,upstream_value,resolution,resolved_at,created_at) VALUES(?,?,?,?,?,?,?,?,?)`,
            runId, 'customer', view.customerId, c.field, JSON.stringify(c.local), JSON.stringify(c.upstream), 'upstream_wins', nowIso(), nowIso()
          );
        }
        // 冲突收敛到上游
        rt.store.run('UPDATE customers SET seas_flag=?, owner_ct_id=?, cust_name=?, sync_state=?, raw_json=?, updated_at=? WHERE customer_id=?',
          view.seasFlag, view.ownerCtId, view.custName, 'synced', JSON.stringify(view.raw ?? {}), nowIso(), view.customerId);
        publishEvent(rt, { type: 'sync.conflict', accountId: account.accountId, entityType: 'customer', entityId: view.customerId, payload: { entity: 'customer', customerId: view.customerId, diffs: changes } });
      }
    }
    rt.store.run(`UPDATE reconcile_runs SET finished_at=?, status='succeeded', stats_json=? WHERE id=?`, nowIso(), JSON.stringify({ checked, diffs }), runId);
  } catch (err) {
    rt.store.run(`UPDATE reconcile_runs SET finished_at=?, status='failed', error=? WHERE id=?`, nowIso(), String(err instanceof Error ? err.message : err).slice(0, 500), runId);
    throw err;
  }
  return { runId, scope: 'customers', accountId: account.accountId, checked, diffs, status: 'succeeded', startedAt, finishedAt: nowIso() };
}

export interface SyncStatusDetail {
  outbox: Record<string, number>;
  lastRunAt: string | null;
  reconcile: { runs: number; lastRunAt: string | null; totalDiffs: number };
}

export function syncStatusDetail(rt: Runtime): SyncStatusDetail {
  const rows = rt.store.all<{ status: string; c: number }>('SELECT status, COUNT(*) AS c FROM sync_outbox GROUP BY status');
  const outbox: Record<string, number> = {};
  for (const r of rows) outbox[r.status] = Number(r.c);
  const last = rt.store.getKv<{ at: string }>('sync:lastRun');
  const runStats = rt.store.get<{ c: number; d: number }>('SELECT COUNT(*) AS c, COALESCE(SUM((SELECT COUNT(*) FROM reconcile_diffs WHERE run_id=reconcile_runs.id)),0) AS d FROM reconcile_runs');
  const lastRun = rt.store.get<{ started_at: string }>('SELECT started_at FROM reconcile_runs ORDER BY id DESC LIMIT 1');
  return { outbox, lastRunAt: last?.at ?? null, reconcile: { runs: Number(runStats?.c ?? 0), lastRunAt: lastRun?.started_at ?? null, totalDiffs: Number(runStats?.d ?? 0) } };
}
