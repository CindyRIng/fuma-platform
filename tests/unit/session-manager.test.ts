import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { createAccount } from '../../src/services/accounts.js';
import { UpstreamClient } from '../../src/upstream/client.js';
import { AppError } from '../../src/core/errors.js';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'fuma-sess-'));
  const rt = createRuntime({ home, silentConsole: true });
  createAccount(rt, { accountId: 'acct_01', name: 'test' });
  return rt;
}

function mockUpstream(handler: (url: string) => Response): UpstreamClient {
  return new UpstreamClient({
    baseUrl: 'https://example.test', pcapiPrefix: '/pcapi', companyId: 10264,
    timeoutMs: 1000, userAgent: 'test', language: 'zh-CN'
  }, async (url) => handler(String(url)));
}

describe('SessionManager', () => {
  it('初始 idle；无 token 心跳 → expired', async () => {
    const rt = setup();
    expect(rt.sessions.getView('acct_01').state).toBe('idle');
    const r = await rt.sessions.heartbeat('acct_01');
    expect(r.ok).toBe(false);
    expect(rt.sessions.getView('acct_01').state).toBe('expired');
    expect(rt.sessions.loadTokens('acct_01')).toBeNull();
    rt.close();
  });

  it('心跳成功/失败（mock 上游）', async () => {
    const rt = setup();
    const encA = rt.box.encrypt('AT');
    const encI = rt.box.encrypt('IAT');
    rt.store.run(
      `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at)
       VALUES(?,?,?,?,?,?,?)`,
      'acct_01', 'online', 'dingtalk_sso_qr', encA, encI, Date.now() + 3600_000, new Date().toISOString()
    );
    expect(rt.sessions.loadTokens('acct_01')?.tokens).toEqual({ accessToken: 'AT', individualAccessToken: 'IAT' });
    (rt as unknown as { upstream: UpstreamClient }).upstream = mockUpstream(() => new Response(JSON.stringify({ code: '0', data: {} }), { status: 200 }));
    const ok = await rt.sessions.heartbeat('acct_01');
    expect(ok.ok).toBe(true);
    (rt as unknown as { upstream: UpstreamClient }).upstream = mockUpstream(() => new Response(JSON.stringify({ code: '-2' }), { status: 200 }));
    const bad = await rt.sessions.heartbeat('acct_01');
    expect(bad.ok).toBe(false);
    expect(rt.sessions.getView('acct_01').state).toBe('expired');
    rt.close();
  });

  it('needsRelogin 依据 token 过期时间', () => {
    const rt = setup();
    rt.store.run(
      `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at)
       VALUES(?,?,?,?,?,?,?)`,
      'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'),
      Date.now() + 10 * 60 * 1000, new Date().toISOString()
    );
    expect(rt.sessions.needsRelogin('acct_01', 45)).toBe(true);
    expect(rt.sessions.needsRelogin('acct_01', 5)).toBe(false);
    rt.close();
  });

  it('logout 清理 token 与状态', async () => {
    const rt = setup();
    rt.store.run(
      `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,updated_at)
       VALUES(?,?,?,?,?,?)`,
      'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), new Date().toISOString()
    );
    const v = await rt.sessions.logout('acct_01');
    expect(v.state).toBe('idle');
    expect(rt.sessions.loadTokens('acct_01')).toBeNull();
    rt.close();
  });

  it('未知账号登录抛 not_found', async () => {
    const rt = setup();
    await expect(rt.sessions.startLogin('nope')).rejects.toMatchObject({ code: 'not_found' });
    rt.close();
  });
});

describe('keepalive expiry', () => {
  it('心跳成功且本地 token 已过期 → 按活动续期刷新有效期，needsRelogin=false', async () => {
    const rt = setup();
    rt.store.run(
      `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at)
       VALUES(?,?,?,?,?,?,?)`,
      'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'),
      Date.now() - 3600_000, new Date().toISOString()
    );
    (rt as unknown as { upstream: UpstreamClient }).upstream = mockUpstream(() => new Response(JSON.stringify({ code: '0', data: {} }), { status: 200 }));
    const r = await rt.sessions.heartbeat('acct_01');
    expect(r.ok).toBe(true);
    expect(rt.sessions.needsRelogin('acct_01')).toBe(false);
    const view = rt.sessions.getView('acct_01');
    expect(view.tokenRemainingSeconds ?? 0).toBeGreaterThan(3600);
    expect(view.state).toBe('online');
    rt.close();
  });
});

describe('stale state', () => {
  it('进程重启后 qr_ready 但 token 有效 → getView 归一化为 online', () => {
    const rt = setup();
    rt.store.run(
      `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,qr_payload,token_expire_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?)`,
      'acct_01', 'qr_ready', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), 'https://x', Date.now() + 3600_000, new Date().toISOString()
    );
    const view = rt.sessions.getView('acct_01');
    expect(view.state).toBe('online');
    expect(view.qr).toBeNull();
    rt.close();
  });
});
