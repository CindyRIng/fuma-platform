import { AppError } from '../core/errors.js';
import { sha256Hex } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';
import { mapCustomer, paging, type CustomerView, type PageResult } from './mappers.js';

const LIST_CACHE_TTL_MS = 60_000;

interface RawCustomer {
  key_id?: string;
  main_id?: string;
  [k: string]: unknown;
}

interface ListResponse {
  totalNum?: number;
  list?: RawCustomer[];
}

function accountCtId(rt: Runtime, accountId: string): number | null {
  const loaded = rt.sessions.loadTokens(accountId);
  if (loaded?.ctId) return loaded.ctId;
  const row = rt.store.get<{ owner_ct_id: string | null }>('SELECT owner_ct_id FROM accounts WHERE account_id=?', accountId);
  return row?.owner_ct_id ? Number(row.owner_ct_id) : null;
}

export function upsertCustomer(rt: Runtime, view: CustomerView): void {
  const now = nowIso();
  const exists = rt.store.get('SELECT customer_id FROM customers WHERE customer_id=?', view.customerId);
  if (!exists) {
    rt.store.run(
      `INSERT INTO customers(customer_id,account_id,c_id,cust_name,cust_short_name,bill_code,country_id,web,tel,mobile,cust_level,cust_source,cust_state,seas_flag,owner_ct_id,owner_dept_key,will_in_sea_at,last_track_at,raw_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      view.customerId, view.accountId, view.cId, view.custName, view.custShortName, view.billCode,
      view.countryId, view.web, view.tel, view.mobile, view.custLevel, view.custSource, view.custState,
      view.seasFlag, view.ownerCtId, view.ownerDeptKey, view.willInSeaDate, null,
      JSON.stringify(view.raw ?? {}), now, now
    );
  } else {
    rt.store.run(
      `UPDATE customers SET account_id=COALESCE(?,account_id), c_id=?, cust_name=?, cust_short_name=?, bill_code=?, country_id=?, web=?, tel=?, mobile=?,
       cust_level=?, cust_source=?, cust_state=?, seas_flag=?, owner_ct_id=?, owner_dept_key=?, will_in_sea_at=?, raw_json=?, updated_at=? WHERE customer_id=?`,
      view.accountId, view.cId, view.custName, view.custShortName, view.billCode, view.countryId, view.web, view.tel, view.mobile,
      view.custLevel, view.custSource, view.custState, view.seasFlag, view.ownerCtId, view.ownerDeptKey, view.willInSeaDate,
      JSON.stringify(view.raw ?? {}), now, view.customerId
    );
  }
}

function localAccountIdFor(rt: Runtime, ownerCtId: number | null): string | null {
  if (!ownerCtId) return null;
  const row = rt.store.get<{ account_id: string }>('SELECT account_id FROM accounts WHERE owner_ct_id=?', String(ownerCtId));
  return row?.account_id ?? null;
}

export interface ListCustomersInput {
  accountId?: string;
  filters?: Record<string, unknown>;
  systemSelection?: Record<string, unknown>;
  page?: number | string;
  pageSize?: number | string;
  sort?: string;
  fresh?: boolean;
}

export async function listCustomers(rt: Runtime, input: ListCustomersInput): Promise<PageResult<CustomerView>> {
  const { from, size, page, pageSize } = paging(input.page, input.pageSize);
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  const cacheKey = `custlist:${account.accountId}:${sha256Hex(JSON.stringify({ filters: input.filters ?? {}, sel: input.systemSelection ?? {}, from, size, sort: input.sort ?? '' }))}`;
  if (!input.fresh) {
    const cached = rt.store.getKv<{ at: number; data: ListCustomersInput & { list: CustomerView[]; totalNum: number } }>(cacheKey);
    if (cached && Date.now() - cached.at < LIST_CACHE_TTL_MS) {
      return { list: cached.data.list, totalNum: cached.data.totalNum, page, pageSize, from, source: 'cache', cachedAt: new Date(cached.at).toISOString() };
    }
  }
  const [sortField, sortDir] = (input.sort ?? 'create_date:desc').split(':');
  const body: Record<string, unknown> = {
    recoveryFlag: false,
    moduleCode: 'NewBF001',
    organizationStructure: { type: 3, ownerCtIdList: [] },
    page: { from, size },
    orderBy: { desc: sortDir === 'asc' ? 'asc' : 'desc', realFieldName: sortField || 'create_date', tableCode: '1' }
  };
  if (input.filters && Object.keys(input.filters).length) body.searchFieldCondition = input.filters;
  if (input.systemSelection && Object.keys(input.systemSelection).length) body.systemSelection = input.systemSelection;

  const data = await pool.runRead(account.accountId, (ctx) => rt.upstream.call<ListResponse>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'POST', path: '/bill/bill/get_page_list', body
  }));
  const ctId = accountCtId(rt, account.accountId);
  const list = (data.list ?? []).map((raw) => {
    const ownerCt = raw.ownerCtId !== undefined ? Number(raw.ownerCtId) : null;
    const accountId = ownerCt && ctId && ownerCt === ctId ? account.accountId : localAccountIdFor(rt, ownerCt);
    return mapCustomer(raw, accountId);
  });
  rt.store.tx(() => { for (const c of list) upsertCustomer(rt, c); });
  const totalNum = Number(data.totalNum ?? list.length);
  rt.store.setKv(cacheKey, { at: Date.now(), data: { list, totalNum } });
  return { list, totalNum, page, pageSize, from, source: 'upstream' };
}

export interface GetCustomerInput {
  customerId: string;
  accountId?: string;
  fresh?: boolean;
}

export interface CustomerDetail {
  customer: CustomerView;
  protection: {
    ownerAccountId: string | null;
    seasFlag: number;
    willInSeaAt: string | null;
    lastTrackAt: string | null;
    protectStartAt: string | null;
  };
  source: 'upstream' | 'cache';
}

export async function getCustomer(rt: Runtime, input: GetCustomerInput): Promise<CustomerDetail> {
  const pool = poolOf(rt);
  const row = rt.store.get<Record<string, unknown>>('SELECT * FROM customers WHERE customer_id=?', input.customerId);
  if (!input.fresh && row?.raw_json) {
    try {
      const raw = JSON.parse(String(row.raw_json)) as Record<string, unknown>;
      return {
        customer: mapCustomer(raw, (row.account_id as string | null) ?? null),
        protection: {
          ownerAccountId: (row.account_id as string | null) ?? null,
          seasFlag: Number(row.seas_flag ?? 0),
          willInSeaAt: (row.will_in_sea_at as string | null) ?? null,
          lastTrackAt: (row.last_track_at as string | null) ?? null,
          protectStartAt: (row.protect_start_at as string | null) ?? null
        },
        source: 'cache'
      };
    } catch {
      /* fallthrough to upstream */
    }
  }
  const account = input.accountId ?? rt.store.get<{ account_id: string }>('SELECT account_id FROM customers WHERE customer_id=?', input.customerId)?.account_id;
  const rawData = await pool.runRead(account, (ctx) => rt.upstream.call<Array<Record<string, unknown>>>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'POST', path: '/bill/bill/get_detail_info',
    body: { masterKeyId: input.customerId, moduleCode: 'NewBF001', structId: 1, desensitizeFlag: true }
  }));
  const raw = Array.isArray(rawData) ? rawData[0] : undefined;
  if (!raw) throw new AppError('not_found', `上游未返回客户详情: ${input.customerId}`);
  const view = mapCustomer(raw, account ?? null);
  rt.store.tx(() => upsertCustomer(rt, view));
  const updated = rt.store.get<Record<string, unknown>>('SELECT * FROM customers WHERE customer_id=?', input.customerId);
  return {
    customer: view,
    protection: {
      ownerAccountId: (updated?.account_id as string | null) ?? null,
      seasFlag: Number(updated?.seas_flag ?? view.seasFlag),
      willInSeaAt: (updated?.will_in_sea_at as string | null) ?? view.willInSeaDate,
      lastTrackAt: (updated?.last_track_at as string | null) ?? null,
      protectStartAt: (updated?.protect_start_at as string | null) ?? null
    },
    source: 'upstream'
  };
}
