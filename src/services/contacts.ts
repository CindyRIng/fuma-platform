import { AppError } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';
import { mapContact, paging, type ContactView, type PageResult } from './mappers.js';

interface ListResponse {
  totalNum?: number;
  list?: Array<Record<string, unknown>>;
}

function upsertContact(rt: Runtime, c: ContactView, accountId: string | null): void {
  const now = nowIso();
  const exists = rt.store.get('SELECT contact_id FROM contacts WHERE contact_id=?', c.contactId);
  if (!exists) {
    rt.store.run(
      `INSERT INTO contacts(contact_id,customer_id,account_id,name,email,whatsapp,mobile,tel,position,role,is_primary,last_track_at,raw_json,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      c.contactId, c.customerId, accountId, c.contName, c.email, '', c.mobile, '', c.position, '', c.isPrimary ? 1 : 0,
      c.lastContactTime, JSON.stringify(c.raw ?? {}), now, now
    );
  } else {
    rt.store.run(
      `UPDATE contacts SET name=?,email=?,mobile=?,position=?,is_primary=?,last_track_at=?,raw_json=?,updated_at=? WHERE contact_id=?`,
      c.contName, c.email, c.mobile, c.position, c.isPrimary ? 1 : 0, c.lastContactTime, JSON.stringify(c.raw ?? {}), now, c.contactId
    );
  }
}

export interface ListContactsInput {
  accountId?: string;
  customerId?: string;
  page?: number | string;
  pageSize?: number | string;
  fresh?: boolean;
}

export async function listContacts(rt: Runtime, input: ListContactsInput): Promise<PageResult<ContactView>> {
  const { from, size, page, pageSize } = paging(input.page, input.pageSize);
  if (input.customerId) {
    const cached = !input.fresh && rt.store.all<Record<string, unknown>>('SELECT * FROM contacts WHERE customer_id=? LIMIT 200', input.customerId);
    if (cached && cached.length) {
      const list = cached.map((row) => mapContact(JSON.parse(String(row.raw_json ?? '{}')) as Record<string, unknown>));
      if (list.length) return { list, totalNum: list.length, page, pageSize, from, source: 'cache' };
    }
  }
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  const body: Record<string, unknown> = {
    moduleCode: 'NewBF003',
    desensitizeFlag: true,
    organizationStructure: { type: '3', ownerCtIdList: [] },
    recoveryFlag: false,
    page: { from, size },
    orderBy: { desc: 'desc', realFieldName: 'primary_contact', tableCode: '1', detailContactFlag: true }
  };
  if (input.customerId) body.subBill = { originModuleCode: 'NewBF001', targetModuleCode: 'NewBF003', keyId: input.customerId };
  const data = await pool.runRead(account.accountId, (ctx) => rt.upstream.call<ListResponse>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'POST', path: '/bill/bill/get_page_list', body
  }));
  const list = (data.list ?? []).map((raw) => mapContact(raw));
  rt.store.tx(() => { for (const c of list) upsertContact(rt, c, account.accountId); });
  return { list, totalNum: Number(data.totalNum ?? list.length), page, pageSize, from, source: 'upstream' };
}
