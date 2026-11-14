import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '../core/errors.js';
import { accountView, capacityOf, createAccount, getAccount, listAccounts, updateAccount } from '../services/accounts.js';
import { healthView, statusView } from '../services/health.js';
import { getCustomer, listCustomers } from '../services/customers.js';
import { listOpenSea } from '../services/open-sea.js';
import { dedupCheck, dedupHistory } from '../services/dedup.js';
import { listContacts } from '../services/contacts.js';
import { listFollowups } from '../services/followups.js';
import { customsCachePurge, customsCacheStats, customsDictionaries, customsQuery } from '../services/customs.js';
import { nowIso } from '../core/time.js';
import { claim, createContact, createCustomer, createFollowup, deleteCustomer, release, updateCustomer } from '../services/writes.js';
import { cancelTask as cancelTaskSvc, createDedupBatch } from '../services/tasks.js';
import { listEvents } from '../core/events.js';
import { reconcileCustomers, retryOutbox, syncStatusDetail } from '../services/sync.js';
import type { Runtime } from '../services/runtime.js';
import { VERSION, SPEC_VERSION } from '../version.js';
import { CAPABILITIES, getCapability, type DispatchContext } from './capabilities.js';

function requireString(input: Record<string, unknown>, key: string): string {
  const v = input[key];
  if (typeof v !== 'string' || v.length === 0) throw new AppError('invalid_argument', `缺少参数 ${key}`);
  return v;
}

/**
 * 能力分发：P2 实现 system/account；其余能力在对应阶段实现（当前显式返回 not_implemented）。
 */
export async function dispatch(rt: Runtime, capabilityId: string, input: Record<string, unknown>, ctx: DispatchContext): Promise<unknown> {
  const cap = getCapability(capabilityId);
  if (!cap) throw new AppError('not_found', `未知能力: ${capabilityId}`);
  if (!cap.implemented) throw new AppError('not_implemented', `能力 ${capabilityId} 将在 ${cap.phase} 阶段实现`);

  switch (capabilityId) {
    case 'system.health':
      return healthView(rt);
    case 'system.status':
      return statusView(rt);
    case 'system.version':
      return {
        version: VERSION,
        specVersion: SPEC_VERSION,
        node: process.version,
        platform: `${process.platform}/${process.arch}`,
        features: { sqlite: true, mcp: true }
      };
    case 'system.capabilities': {
      const category = typeof input.category === 'string' ? input.category : undefined;
      const onlyImplemented = input.implemented === true;
      return CAPABILITIES
        .filter((c) => (!category || c.category === category) && (!onlyImplemented || c.implemented))
        .map((c) => ({
          id: c.id,
          title: c.title,
          summary: c.summary,
          category: c.category,
          phase: c.phase,
          mutating: c.mutating,
          implemented: c.implemented,
          cli: `fuma ${c.noun} ${c.verb}`,
          rest: `${c.http.method} ${c.http.path}`,
          mcp: c.mcp.tool
        }));
    }
    case 'account.list':
      return listAccounts(rt).map((a) => ({ ...a, capacity: capacityOf(rt, a.accountId) }));
    case 'account.get': {
      const accountId = requireString(input, 'accountId');
      return accountView(rt, accountId);
    }
    case 'account.create': {
      const accountId = requireString(input, 'accountId');
      return createAccount(rt, {
        accountId,
        name: typeof input.name === 'string' ? input.name : undefined,
        ownerName: typeof input.ownerName === 'string' ? input.ownerName : undefined,
        loginMode: typeof input.loginMode === 'string' ? input.loginMode : undefined,
        dingtalkOrg: typeof input.dingtalkOrg === 'string' ? input.dingtalkOrg : undefined,
        fumaEnterprise: typeof input.fumaEnterprise === 'string' ? input.fumaEnterprise : undefined,
        capacityLimit: typeof input.capacityLimit === 'number' ? input.capacityLimit : undefined,
        keepBrowserAlive: input.keepBrowserAlive === true
      });
    }
    case 'account.update': {
      const accountId = requireString(input, 'accountId');
      return updateAccount(rt, accountId, {
        ...(typeof input.name === 'string' ? { name: input.name } : {}),
        ...(typeof input.ownerName === 'string' ? { ownerName: input.ownerName } : {}),
        ...(typeof input.status === 'string' ? { status: input.status } : {}),
        ...(typeof input.capacityLimit === 'number' ? { capacityLimit: input.capacityLimit } : {}),
        ...(typeof input.keepBrowserAlive === 'boolean' ? { keepBrowserAlive: input.keepBrowserAlive } : {})
      });
    }
    case 'account.capacity':
      return capacityOf(rt, requireString(input, 'accountId'));
    case 'session.list':
      return rt.sessions.listViews();
    case 'session.status':
      return rt.sessions.getView(requireString(input, 'accountId'));
    case 'session.login': {
      const accountId = requireString(input, 'accountId');
      const mode = typeof input.mode === 'string' ? input.mode : 'dingtalk_sso_qr';
      return rt.sessions.startLogin(accountId, mode);
    }
    case 'session.qr': {
      const accountId = requireString(input, 'accountId');
      const qr = await rt.sessions.getQr(accountId);
      const dir = resolve(rt.paths.home, 'qr');
      mkdirSync(dir, { recursive: true, mode: 0o700 });
      const pngPath = resolve(dir, `${accountId}.png`);
      writeFileSync(pngPath, Buffer.from(qr.pngBase64, 'base64'), { mode: 0o600 });
      return { ...qr, pngPath };
    }
    case 'session.cancel':
      return rt.sessions.cancel(requireString(input, 'accountId'));
    case 'session.logout':
      return rt.sessions.logout(requireString(input, 'accountId'));
    case 'session.heartbeat':
      return rt.sessions.heartbeat(requireString(input, 'accountId'));
    case 'customer.list':
      return listCustomers(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        filters: (input.filters as Record<string, unknown> | undefined),
        systemSelection: (input.systemSelection as Record<string, unknown> | undefined),
        page: input.page as number | string | undefined,
        pageSize: input.pageSize as number | string | undefined,
        sort: typeof input.sort === 'string' ? input.sort : undefined,
        fresh: input.fresh === true
      });
    case 'customer.get':
      return getCustomer(rt, {
        customerId: requireString(input, 'customerId'),
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        fresh: input.fresh === true
      });
    case 'open_sea.list':
      return listOpenSea(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        filters: input.filters as Record<string, unknown> | undefined,
        systemSelection: input.systemSelection as Record<string, unknown> | undefined,
        page: input.page as number | string | undefined,
        pageSize: input.pageSize as number | string | undefined,
        fresh: input.fresh === true
      });
    case 'dedup.check':
      return dedupCheck(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        keywords: requireString(input, 'keywords'),
        moduleCode: typeof input.moduleCode === 'string' ? input.moduleCode : undefined
      });
    case 'dedup.history':
      return dedupHistory(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        moduleCode: typeof input.moduleCode === 'string' ? input.moduleCode : undefined,
        size: input.size as number | string | undefined
      });
    case 'contact.list':
      return listContacts(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        customerId: typeof input.customerId === 'string' ? input.customerId : undefined,
        page: input.page as number | string | undefined,
        pageSize: input.pageSize as number | string | undefined,
        fresh: input.fresh === true
      });
    case 'followup.list':
      return listFollowups(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        customerId: typeof input.customerId === 'string' ? input.customerId : undefined,
        page: input.page as number | string | undefined,
        pageSize: input.pageSize as number | string | undefined
      });
    case 'customs.query':
      return customsQuery(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        inputCompany: requireString(input, 'inputCompany'),
        companyFlag: input.companyFlag as number | string | undefined,
        page: input.page as number | string | undefined,
        pageSize: input.pageSize as number | string | undefined,
        forceRefresh: input.forceRefresh === true,
        allowStale: input.allowStale !== false
      });
    case 'customs.dictionaries':
      return customsDictionaries(rt, {
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        kind: typeof input.kind === 'string' ? input.kind : undefined
      });
    case 'customs.cache.stats':
      return customsCacheStats(rt);
    case 'customs.cache.purge':
      return customsCachePurge(rt, {
        queryType: typeof input.queryType === 'string' ? input.queryType : undefined,
        company: typeof input.company === 'string' ? input.company : undefined,
        before: typeof input.before === 'string' ? input.before : undefined
      });
    case 'task.get': {
      const taskId = requireString(input, 'taskId');
      const row = rt.store.get<Record<string, unknown>>('SELECT * FROM tasks WHERE task_id=?', taskId);
      if (!row) throw new AppError('not_found', `任务不存在: ${taskId}`);
      return { taskId: row.task_id, type: row.type, status: row.status, progressDone: row.progress_done, progressTotal: row.progress_total, accountId: row.account_id, createdAt: row.created_at, startedAt: row.started_at, finishedAt: row.finished_at, result: row.result_json ? JSON.parse(String(row.result_json)) : null, error: row.error };
    }
    case 'task.list': {
      const page = Math.max(1, Number(input.page ?? 1) || 1);
      const pageSize = Math.min(100, Math.max(1, Number(input.pageSize ?? 20) || 20));
      const status = typeof input.status === 'string' ? input.status : undefined;
      const type = typeof input.type === 'string' ? input.type : undefined;
      const where: string[] = [];
      const params: unknown[] = [];
      if (status) { where.push('status=?'); params.push(status); }
      if (type) { where.push('type=?'); params.push(type); }
      const sqlWhere = where.length ? ` WHERE ${where.join(' AND ')}` : '';
      const rows = rt.store.all<Record<string, unknown>>(`SELECT * FROM tasks${sqlWhere} ORDER BY created_at DESC LIMIT ? OFFSET ?`, ...params, pageSize, (page - 1) * pageSize);
      const total = rt.store.get<{ c: number }>(`SELECT COUNT(*) AS c FROM tasks${sqlWhere}`, ...params);
      return { list: rows.map((r) => ({ taskId: r.task_id, type: r.type, status: r.status, progressDone: r.progress_done, progressTotal: r.progress_total, createdAt: r.created_at, finishedAt: r.finished_at })), totalNum: Number(total?.c ?? 0), page, pageSize };
    }
    case 'customer.create':
      return createCustomer(rt, {
        accountId: requireString(input, 'accountId'),
        data: (input.data as Record<string, unknown>) ?? {},
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'customer.update':
      return updateCustomer(rt, {
        accountId: requireString(input, 'accountId'),
        customerId: requireString(input, 'customerId'),
        data: (input.data as Record<string, unknown>) ?? {},
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'customer.delete':
      return deleteCustomer(rt, {
        accountId: requireString(input, 'accountId'),
        customerId: requireString(input, 'customerId'),
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'open_sea.claim':
      return claim(rt, {
        accountId: requireString(input, 'accountId'),
        customerId: requireString(input, 'customerId'),
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'open_sea.release':
      return release(rt, {
        accountId: requireString(input, 'accountId'),
        customerId: requireString(input, 'customerId'),
        reason: typeof input.reason === 'string' ? input.reason : undefined,
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'followup.create':
      return createFollowup(rt, {
        accountId: requireString(input, 'accountId'),
        customerId: requireString(input, 'customerId'),
        content: requireString(input, 'content'),
        method: typeof input.method === 'string' ? input.method : undefined,
        followedAt: typeof input.followedAt === 'string' ? input.followedAt : undefined,
        nextFollowupAt: typeof input.nextFollowupAt === 'string' ? input.nextFollowupAt : undefined,
        contactId: typeof input.contactId === 'string' ? input.contactId : undefined,
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'contact.create':
      return createContact(rt, {
        accountId: requireString(input, 'accountId'),
        customerId: requireString(input, 'customerId'),
        data: (input.data as Record<string, unknown>) ?? {},
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined
      });
    case 'dedup.batch': {
      const keywords = Array.isArray(input.keywords) ? (input.keywords as string[]) : [];
      return createDedupBatch(rt, {
        keywords,
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined,
        idempotencyKey: typeof input.idempotencyKey === 'string' ? input.idempotencyKey : undefined,
        chunkSize: typeof input.chunkSize === 'number' ? input.chunkSize : undefined
      });
    }
    case 'task.cancel':
      return cancelTaskSvc(rt, requireString(input, 'taskId'));
    case 'event.list':
      return listEvents(rt, {
        sinceSeq: input.sinceSeq as number | string | undefined,
        limit: input.limit as number | string | undefined,
        type: typeof input.type === 'string' ? input.type : undefined,
        accountId: typeof input.accountId === 'string' ? input.accountId : undefined
      });
    case 'sync.status':
      return syncStatusDetail(rt);
    case 'sync.reconcile':
      return reconcileCustomers(rt, typeof input.accountId === 'string' ? input.accountId : undefined);
    case 'sync.retry':
      return retryOutbox(rt, Number(input.outboxId));
    default:
      throw new AppError('not_implemented', `能力 ${capabilityId} 尚未实现`);
  }
}
