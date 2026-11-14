import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';
import { mapCustomer, paging, type CustomerView, type PageResult } from './mappers.js';
import { upsertCustomer } from './customers.js';

export interface ListOpenSeaInput {
  accountId?: string;
  filters?: Record<string, unknown>;
  systemSelection?: Record<string, unknown>;
  page?: number | string;
  pageSize?: number | string;
  fresh?: boolean;
}

interface ListResponse {
  totalNum?: number;
  list?: Array<Record<string, unknown>>;
}

/** 公海列表：moduleCode=NewBF001 + seasFlag_eq=1（实测 379,597 条）。 */
export async function listOpenSea(rt: Runtime, input: ListOpenSeaInput): Promise<PageResult<CustomerView>> {
  const { from, size, page, pageSize } = paging(input.page, input.pageSize);
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  const filters = { ...(input.filters ?? {}), seasFlag_eq: 1 };
  const body: Record<string, unknown> = {
    recoveryFlag: false,
    moduleCode: 'NewBF001',
    organizationStructure: { type: 3, ownerCtIdList: [] },
    page: { from, size },
    orderBy: { desc: 'desc', realFieldName: 'create_date', tableCode: '1' },
    searchFieldCondition: filters
  };
  if (input.systemSelection && Object.keys(input.systemSelection).length) body.systemSelection = input.systemSelection;
  const data = await pool.runRead(account.accountId, (ctx) => rt.upstream.call<ListResponse>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'POST', path: '/bill/bill/get_page_list', body
  }));
  const list = (data.list ?? []).map((raw) => mapCustomer(raw, null));
  rt.store.tx(() => {
    for (const c of list) {
      upsertCustomer(rt, { ...c, seasFlag: 1 });
    }
  });
  return { list, totalNum: Number(data.totalNum ?? list.length), page, pageSize, from, source: 'upstream' };
}
