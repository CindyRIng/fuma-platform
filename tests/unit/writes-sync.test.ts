import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { createAccount } from '../../src/services/accounts.js';
import { UpstreamClient } from '../../src/upstream/client.js';
import { claim, createCustomer, createFollowup, release } from '../../src/services/writes.js';
import { processOutboxOnce, reconcileCustomers } from '../../src/services/sync.js';
import { listEvents } from '../../src/core/events.js';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'fuma-writes-'));
  const rt = createRuntime({ home, silentConsole: true });
  createAccount(rt, { accountId: 'acct_01', ownerCtId: '13148056' });
  rt.store.run(
    `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at,ct_id,c_id)
     VALUES(?,?,?,?,?,?,?,?,?)`,
    'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), Date.now() + 3600_000, new Date().toISOString(), 13148056, 10264
  );
  return rt;
}

interface MockOpts { dedupCount?: number; tradeCalls?: { claim: number; putSeas: number; add: number; detail: number; addOne?: number }; failClaim?: boolean; upstreamCustomerSeas?: number }

function mock(rt: ReturnType<typeof setup>, opts: MockOpts = {}) {
  const calls: { claim: number; putSeas: number; add: number; detail: number; addOne: number; bodies: Array<{ url: string; body: string }> } = { claim: 0, putSeas: 0, add: 0, detail: 0, addOne: 0, bodies: [], ...(opts.tradeCalls ?? {}) };
  const client = new UpstreamClient(
    { baseUrl: 'https://example.test', pcapiPrefix: '/pcapi', companyId: 10264, timeoutMs: 1000, userAgent: 't', language: 'zh-CN' },
    async (url, init) => {
      const u = String(url);
      const body = init?.body ? JSON.parse(String(init.body)) : {};
      if (u.includes('get_detail_info')) {
        calls.detail++;
        return new Response(JSON.stringify({ code: '0', data: [{ key_id: body.masterKeyId, custName: 'ZZTESTCO', seasFlag: opts.upstreamCustomerSeas ?? 1, ownerCtId: 13148056, cId: 10264 }] }), { status: 200 });
      }
      if (u.includes('repeat/check')) return new Response(JSON.stringify({ code: '0', data: { count: String(opts.dedupCount ?? 0) } }), { status: 200 });
      if (u.includes('doBatchReceive')) {
        calls.claim++;
        if (opts.failClaim) return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ code: '0', data: '' }), { status: 200 });
      }
      if (u.includes('doBatchPutSeas')) { calls.putSeas++; return new Response(JSON.stringify({ code: '0', data: '' }), { status: 200 }); }
      if (u.includes('addSingleCustomer')) { calls.add++; return new Response(JSON.stringify({ code: '0', data: 'NEW_ID_1' }), { status: 200 }); }
      if (u.includes('bill/bill/add_one')) { calls.addOne++; calls.bodies.push({ url: u, body: String(init?.body ?? '') }); return new Response(JSON.stringify({ code: '0', data: 'FOLLOW_1' }), { status: 200 }); }
      if (u.includes('get_page_list')) return new Response(JSON.stringify({ code: '0', data: { totalNum: 1, list: [{ key_id: 'C1', custName: 'ZZTESTCO', seasFlag: opts.upstreamCustomerSeas ?? 1, ownerCtId: 13148056 }] } }), { status: 200 });
      return new Response(JSON.stringify({ code: '0', data: {} }), { status: 200 });
    }
  );
  (rt as unknown as { upstream: UpstreamClient }).upstream = client;
  return calls;
}

describe('claims / local-first / sync', () => {
  it('领取：本地先事实 → outbox → 同步成功 → synced + 事件', async () => {
    const rt = setup();
    const calls = mock(rt);
    const r = await claim(rt, { accountId: 'acct_01', customerId: 'C1' });
    expect(r.syncState).toBe('pending');
    expect(r.outboxId).not.toBeNull();
    const cust = rt.store.get<{ seas_flag: number; sync_state: string; account_id: string }>('SELECT * FROM customers WHERE customer_id=?', 'C1');
    expect(cust?.seas_flag).toBe(0);
    expect(cust?.sync_state).toBe('pending');
    expect(cust?.account_id).toBe('acct_01');
    const evts = listEvents(rt).events.map((e) => e.type);
    expect(evts).toContain('open_sea.claimed');
    const run = await processOutboxOnce(rt);
    expect(run.succeeded).toBe(1);
    expect(calls.claim).toBe(1);
    const synced = rt.store.get<{ sync_state: string }>('SELECT * FROM customers WHERE customer_id=?', 'C1');
    expect(synced?.sync_state).toBe('synced');
    expect(listEvents(rt).events.map((e) => e.type)).toContain('customer.synced');
    rt.close();
  });

  it('强制先查后领：查重命中 → 拒绝且无上游写请求', async () => {
    const rt = setup();
    const calls = mock(rt, { dedupCount: 2 });
    await expect(claim(rt, { accountId: 'acct_01', customerId: 'C1' })).rejects.toMatchObject({ code: 'duplicate_customer' });
    expect(calls.claim).toBe(0);
    rt.close();
  });

  it('释放冷却：释放后 3 天内不可领取', async () => {
    const rt = setup();
    mock(rt);
    rt.store.run(
      `INSERT INTO capacity_ledger(account_id,delta,reason,customer_id,created_at) VALUES(?,?,?,?,?)`,
      'acct_01', -1, 'release', 'C1', new Date().toISOString()
    );
    await expect(claim(rt, { accountId: 'acct_01', customerId: 'C1' })).rejects.toMatchObject({ code: 'cooldown_active' });
    rt.close();
  });

  it('建档本地优先 → outbox create → 同步拿到 upstream_id', async () => {
    const rt = setup();
    const calls = mock(rt);
    const r = await createCustomer(rt, { accountId: 'acct_01', data: { custName: 'ZZ_TEST_FUMA_LOCAL1', custShortName: 'ZZT' } });
    expect(String(r.customerId).startsWith('local_')).toBe(true);
    expect(r.syncState).toBe('pending');
    const run = await processOutboxOnce(rt);
    expect(run.succeeded).toBe(1);
    expect(calls.add).toBe(1);
    const row = rt.store.get<{ sync_state: string; upstream_id: string | null }>('SELECT * FROM customers WHERE customer_id=?', r.customerId);
    expect(row?.sync_state).toBe('synced');
    expect(row?.upstream_id).toBe('NEW_ID_1');
    rt.close();
  });

  it('跟进新增：本地优先 → bill/add_one 同步成功', async () => {
    const rt = setup();
    const calls = mock(rt);
    const r = await createFollowup(rt, { accountId: 'acct_01', customerId: 'C1', content: 'ZZ_TEST followup content' });
    expect(r.syncState).toBe('pending');
    const run = await processOutboxOnce(rt);
    expect(run.succeeded).toBe(1);
    expect(calls.addOne).toBe(1);
    const addOne = calls.bodies.find((b) => b.url.includes('bill/bill/add_one'));
    expect(addOne).toBeTruthy();
    const parsed = JSON.parse(addOne!.body) as { moduleCode: string; bill: Record<string, Array<Record<string, unknown>>> };
    expect(parsed.moduleCode).toBe('NewBF004');
    expect(parsed.bill['1'][0].trackContent).toBe('ZZ_TEST followup content');
    const row = rt.store.get<{ sync_state: string }>('SELECT * FROM followups WHERE followup_id=?', r.followupId);
    expect(row?.sync_state).toBe('synced');
    rt.close();
  });

  it('同步失败 → failed 重试 → 手动 retry 后成功', async () => {
    const rt = setup();
    const calls = mock(rt, { failClaim: true });
    const r = await claim(rt, { accountId: 'acct_01', customerId: 'C1' });
    const run1 = await processOutboxOnce(rt);
    expect(run1.failed).toBe(1);
    const ob = rt.store.get<{ status: string; attempts: number; next_retry_at: string | null }>('SELECT * FROM sync_outbox WHERE id=?', r.outboxId!);
    expect(ob?.status).toBe('failed');
    // 清空重试时间，模拟到期
    rt.store.run('UPDATE sync_outbox SET next_retry_at=NULL WHERE id=?', r.outboxId!);
    (rt as unknown as { upstream: UpstreamClient }).upstream = new UpstreamClient(
      { baseUrl: 'https://example.test', pcapiPrefix: '/pcapi', companyId: 10264, timeoutMs: 1000, userAgent: 't', language: 'zh-CN' },
      async (url) => new Response(JSON.stringify({ code: '0', data: String(url).includes('repeat/check') ? { count: '0' } : '' }), { status: 200 })
    );
    const run2 = await processOutboxOnce(rt);
    expect(run2.succeeded).toBe(1);
    expect(calls.claim).toBeGreaterThanOrEqual(1);
    rt.close();
  });
});

describe('reconcile', () => {
  it('ownerCtId 13148056.0 与 13148056 视为相同，不产生伪 diff', async () => {
    const rt = setup();
    mock(rt, { upstreamCustomerSeas: 0 });
    const now = new Date().toISOString();
    rt.store.run(
      `INSERT INTO customers(customer_id,account_id,seas_flag,owner_ct_id,sync_state,created_at,updated_at) VALUES(?,?,?,?,?,?,?)`,
      'C1', 'acct_01', 0, '13148056.0', 'synced', now, now
    );
    const report = await reconcileCustomers(rt, 'acct_01');
    expect(report.diffs).toBe(0);
    rt.close();
  });

  it('上游事实变化 → 收敛上游 + sync.conflict 事件 + diff 记录', async () => {
    const rt = setup();
    mock(rt, { upstreamCustomerSeas: 1 });
    const now = new Date().toISOString();
    rt.store.run(
      `INSERT INTO customers(customer_id,account_id,seas_flag,sync_state,created_at,updated_at) VALUES(?,?,?,?,?,?)`,
      'C1', 'acct_01', 0, 'synced', now, now
    );
    const report = await reconcileCustomers(rt, 'acct_01');
    expect(report.diffs).toBeGreaterThan(0);
    const cust = rt.store.get<{ seas_flag: number }>('SELECT * FROM customers WHERE customer_id=?', 'C1');
    expect(cust?.seas_flag).toBe(1);
    expect(listEvents(rt).events.map((e) => e.type)).toContain('sync.conflict');
    rt.close();
  });
});
