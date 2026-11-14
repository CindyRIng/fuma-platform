import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { createAccount } from '../../src/services/accounts.js';
import { customsCacheStats, customsQuery } from '../../src/services/customs.js';
import { UpstreamClient } from '../../src/upstream/client.js';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'fuma-customs-'));
  const rt = createRuntime({ home, silentConsole: true });
  createAccount(rt, { accountId: 'acct_01' });
  rt.store.run(
    `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at)
     VALUES(?,?,?,?,?,?,?)`,
    'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), Date.now() + 3600_000, new Date().toISOString()
  );
  return rt;
}

function mock(rt: ReturnType<typeof setup>, opts: { tradeCalls: { n: number }; failTrade?: boolean }) {
  const client = new UpstreamClient(
    { baseUrl: 'https://example.test', pcapiPrefix: '/pcapi', companyId: 10264, timeoutMs: 1000, userAgent: 't', language: 'zh-CN' },
    async (url) => {
      const u = String(url);
      if (u.includes('GetTradeUpdateLog')) {
        return new Response(JSON.stringify({ code: '0', data: { AllCount: 12345 } }), { status: 200 });
      }
      if (u.includes('tradeList')) {
        opts.tradeCalls.n++;
        if (opts.failTrade) return new Response('{}', { status: 500 });
        return new Response(JSON.stringify({ code: 0, data: { exactCount: 1, allcount: 19504037, data: [{ tradeno: 'T1', importer: 'ACME' }] } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: '0', data: {} }), { status: 200 });
    }
  );
  (rt as unknown as { upstream: UpstreamClient }).upstream = client;
}

describe('customs cache', () => {
  it('首次走上游、第二次命中缓存、forceRefresh 再走上游', async () => {
    const rt = setup();
    const counter = { n: 0 };
    mock(rt, { tradeCalls: counter });
    const r1 = await customsQuery(rt, { inputCompany: 'Ningbo', pageSize: 2 });
    expect(r1.source).toBe('upstream');
    expect(r1.cached).toBe(false);
    expect(r1.allCount).toBe(19504037);
    const r2 = await customsQuery(rt, { inputCompany: 'Ningbo', pageSize: 2 });
    expect(r2.cached).toBe(true);
    expect(r2.source).toBe('cache');
    expect(counter.n).toBe(1);
    const r3 = await customsQuery(rt, { inputCompany: 'Ningbo', pageSize: 2, forceRefresh: true });
    expect(r3.source).toBe('upstream');
    expect(counter.n).toBe(2);
    const stats = customsCacheStats(rt);
    expect(stats.entries).toBe(1);
    expect(stats.totalHits).toBe(1);
    rt.close();
  });

  it('上游失败时返回 stale 缓存（allowStale）', async () => {
    const rt = setup();
    const counter = { n: 0 };
    mock(rt, { tradeCalls: counter });
    await customsQuery(rt, { inputCompany: 'ABC', pageSize: 2 });
    mock(rt, { tradeCalls: counter, failTrade: true });
    const r = await customsQuery(rt, { inputCompany: 'ABC', pageSize: 2, forceRefresh: true });
    expect(r.source).toBe('cache');
    expect(r.stale).toBe(true);
    rt.close();
  });

  it('无会话时：有缓存可 stale 返回，无缓存报 session_expired', async () => {
    const rt = setup();
    const counter = { n: 0 };
    mock(rt, { tradeCalls: counter });
    await customsQuery(rt, { inputCompany: 'XYZ', pageSize: 2 });
    // 使缓存过期（模拟 TTL 到期）
    rt.store.run('UPDATE customs_cache_entries SET expires_at=?', new Date(Date.now() - 60_000).toISOString());
    rt.store.run('DELETE FROM sessions');
    const r = await customsQuery(rt, { inputCompany: 'XYZ', pageSize: 2 });
    expect(r.stale).toBe(true);
    await expect(customsQuery(rt, { inputCompany: 'NEWCO', pageSize: 2 })).rejects.toMatchObject({ code: 'session_expired' });
    rt.close();
  });

  it('非法 inputCompany 被拒绝', async () => {
    const rt = setup();
    await expect(customsQuery(rt, { inputCompany: 'X' })).rejects.toMatchObject({ code: 'invalid_argument' });
    rt.close();
  });
});
