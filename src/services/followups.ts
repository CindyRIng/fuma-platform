import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';
import { mapFollowup, paging, type FollowupView, type PageResult } from './mappers.js';
import { nowIso } from '../core/time.js';

interface ListResponse {
  totalNum?: number;
  list?: Array<Record<string, unknown>>;
}

function upsertFollowup(rt: Runtime, f: FollowupView, accountId: string | null): void {
  const now = nowIso();
  const exists = rt.store.get('SELECT followup_id FROM followups WHERE followup_id=?', f.followupId);
  if (!exists) {
    rt.store.run(
      `INSERT INTO followups(followup_id,customer_id,account_id,method,content,followed_at,next_followup_at,related_module,related_id,raw_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?)`,
      f.followupId, f.customerId, accountId, f.trackMode, f.trackContent, f.trackDate, f.nextTrackDate || null,
      'NewBF004', f.followupId, JSON.stringify(f.raw ?? {}), now, now
    );
  } else {
    rt.store.run(
      `UPDATE followups SET method=?,content=?,followed_at=?,next_followup_at=?,raw_json=?,updated_at=? WHERE followup_id=?`,
      f.trackMode, f.trackContent, f.trackDate, f.nextTrackDate || null, JSON.stringify(f.raw ?? {}), now, f.followupId
    );
  }
}

export interface ListFollowupsInput {
  accountId?: string;
  customerId?: string;
  page?: number | string;
  pageSize?: number | string;
  fresh?: boolean;
}

/** 跟进列表：moduleCode=NewBF004（实测 body 带 trackMode_notin）。 */
export async function listFollowups(rt: Runtime, input: ListFollowupsInput): Promise<PageResult<FollowupView>> {
  const { from, size, page, pageSize } = paging(input.page, input.pageSize);
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  const body: Record<string, unknown> = {
    recoveryFlag: false,
    moduleCode: 'NewBF004',
    organizationStructure: { type: 3, ownerCtIdList: [] },
    page: { from, size },
    orderBy: { desc: 'desc', realFieldName: 'create_date', tableCode: '1' },
    searchFieldCondition: { trackMode_notin: '7,8,10,200,201' }
  };
  if (input.customerId) {
    // 实测（2026-11-15）：跟进列表按客户过滤用 custId_eq，subBill 方式会 1007
    body.searchFieldCondition = { ...(body.searchFieldCondition as Record<string, unknown>), custId_eq: input.customerId };
  }
  const data = await pool.runRead(account.accountId, (ctx) => rt.upstream.call<ListResponse>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'POST', path: '/bill/bill/get_page_list', body
  }));
  const list = (data.list ?? []).map((raw) => mapFollowup(raw));
  rt.store.tx(() => { for (const f of list) upsertFollowup(rt, f, account.accountId); });
  return { list, totalNum: Number(data.totalNum ?? list.length), page, pageSize, from, source: 'upstream' };
}
