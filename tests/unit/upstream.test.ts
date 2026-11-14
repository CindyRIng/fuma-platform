import { describe, expect, it } from 'vitest';
import { UpstreamClient } from '../../src/upstream/client.js';

const opts = {
  baseUrl: 'https://example.test',
  pcapiPrefix: '/pcapi',
  companyId: 10264,
  timeoutMs: 2000,
  userAgent: 'test-agent',
  language: 'zh-cn'
};

const tokens = { accessToken: 'AT', individualAccessToken: 'IAT' };

function mockResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } });
}

describe('UpstreamClient', () => {
  it('GET 将 token 与公共参数注入 query', async () => {
    let seenUrl = '';
    const client = new UpstreamClient(opts, async (url) => {
      seenUrl = String(url);
      return mockResponse({ code: '0', data: { ok: true } });
    });
    const data = await client.call({ accountId: 'acct', tokens }, { method: 'GET', path: '/bill/bill/get_page_list' }) as Record<string, unknown>;
    expect(data.ok).toBe(true);
    expect(seenUrl).toContain('accessToken=AT');
    expect(seenUrl).toContain('individualAccessToken=IAT');
    expect(seenUrl).toContain('_filterCompanyId=10264');
    expect(seenUrl).toContain('event_source=MX');
  });

  it('POST 将 token 与公共参数注入 body', async () => {
    let seenBody: Record<string, unknown> = {};
    const client = new UpstreamClient(opts, async (_url, init) => {
      seenBody = JSON.parse(String(init?.body ?? '{}'));
      return mockResponse({ code: 0, data: { count: 0 } });
    });
    await client.call({ accountId: 'acct', tokens }, { method: 'POST', path: '/bill/repeat/check', body: { keywords: 'x' } });
    expect(seenBody.accessToken).toBe('AT');
    expect(seenBody.keywords).toBe('x');
    expect(seenBody._filterCompanyId).toBe(10264);
  });

  it('code=-2 映射 session_expired（不重试）', async () => {
    let calls = 0;
    const client = new UpstreamClient(opts, async () => { calls++; return mockResponse({ code: '-2' }); });
    await expect(client.call({ accountId: 'acct', tokens }, { method: 'GET', path: '/x', retry: { maxAttempts: 2 } }))
      .rejects.toMatchObject({ code: 'session_expired' });
    expect(calls).toBe(1);
  });

  it('code=-1 自动重试后成功', async () => {
    let calls = 0;
    const client = new UpstreamClient(opts, async () => {
      calls++;
      return calls === 1 ? mockResponse({ code: '-1', msg: 'busy' }) : mockResponse({ code: '0', data: { ok: 1 } });
    });
    const data = await client.call({ accountId: 'acct', tokens }, { method: 'GET', path: '/x', retry: { maxAttempts: 2, baseDelayMs: 1 } }) as Record<string, unknown>;
    expect(data.ok).toBe(1);
    expect(calls).toBe(2);
  });

  it('code=1004 不重试并抛 upstream_error', async () => {
    let calls = 0;
    const client = new UpstreamClient(opts, async () => { calls++; return mockResponse({ code: '1004', serverMsgs: [{ errorMsg: 'boom' }] }); });
    await expect(client.call({ accountId: 'acct', tokens }, { method: 'POST', path: '/x', body: {}, retry: { maxAttempts: 3, baseDelayMs: 1 } }))
      .rejects.toMatchObject({ code: 'upstream_error' });
    expect(calls).toBe(1);
  });

  it('withAuth=false 不注入 token', async () => {
    let seenUrl = '';
    const client = new UpstreamClient(opts, async (url) => { seenUrl = String(url); return mockResponse({ code: '0', data: {} }); });
    await client.call({ accountId: 'acct', tokens }, { method: 'GET', path: '/login/x', withAuth: false });
    expect(seenUrl).not.toContain('accessToken=');
  });
});
