import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { dispatch } from '../../src/api/dispatch.js';
import { createRuntime } from '../../src/services/runtime.js';

function rt() {
  const home = mkdtempSync(join(tmpdir(), 'fuma-disp-'));
  return createRuntime({ home, silentConsole: true });
}

const ctx = { requestId: 'req_t', actor: 'internal' as const };

describe('dispatch', () => {
  it('system.health', async () => {
    const r = rt();
    const data = await dispatch(r, 'system.health', {}, ctx) as Record<string, unknown>;
    expect(data.status).toBe('ok');
    expect(data.db).toBe('ok');
    r.close();
  });

  it('system.capabilities 支持过滤', async () => {
    const r = rt();
    const all = await dispatch(r, 'system.capabilities', {}, ctx) as unknown[];
    expect(all.length).toBeGreaterThan(10);
    const implemented = await dispatch(r, 'system.capabilities', { implemented: true }, ctx) as unknown[];
    expect(implemented.length).toBeLessThanOrEqual(all.length);
    r.close();
  });

  it('account 生命周期', async () => {
    const r = rt();
    const created = await dispatch(r, 'account.create', { accountId: 'acct_x', name: 'x' }, ctx) as Record<string, unknown>;
    expect(created.accountId).toBe('acct_x');
    const list = await dispatch(r, 'account.list', {}, ctx) as unknown[];
    expect(list.length).toBe(1);
    const cap = await dispatch(r, 'account.capacity', { accountId: 'acct_x' }, ctx) as Record<string, unknown>;
    expect(cap.limit).toBe(500);
    r.close();
  });

  it('未实现能力与未知能力错误', async () => {
    const r = rt();
    await expect(dispatch(r, 'contact.update', { accountId: 'acct_x', contactId: 'c', data: {} }, ctx)).rejects.toMatchObject({ code: 'not_implemented' });
    await expect(dispatch(r, 'nope.nope', {}, ctx)).rejects.toMatchObject({ code: 'not_found' });
    r.close();
  });
});
