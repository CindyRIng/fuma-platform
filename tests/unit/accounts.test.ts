import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { writeConfig } from '../../src/config.js';
import { capacityOf, createAccount, getAccount, listAccounts, updateAccount } from '../../src/services/accounts.js';

function rt() {
  const home = mkdtempSync(join(tmpdir(), 'fuma-acc-'));
  return createRuntime({ home, silentConsole: true });
}

describe('accounts', () => {
  it('创建/查询/更新账号', () => {
    const r = rt();
    const acc = createAccount(r, { accountId: 'acct_01', name: '测试账号', ownerName: '宋释孟' });
    expect(acc.accountId).toBe('acct_01');
    expect(acc.capacityLimit).toBe(500);
    expect(listAccounts(r).length).toBe(1);
    const updated = updateAccount(r, 'acct_01', { status: 'active', name: '测试2' });
    expect(updated.status).toBe('active');
    expect(updated.name).toBe('测试2');
    expect(() => createAccount(r, { accountId: 'acct_01' })).toThrow(/已存在/);
    expect(() => getAccount(r, 'nope')).toThrow(/不存在/);
    r.close();
  });

  it('容量统计只计算保护客户', () => {
    const r = rt();
    createAccount(r, { accountId: 'acct_01' });
    const now = new Date().toISOString();
    r.store.run(
      `INSERT INTO customers(customer_id,account_id,seas_flag,created_at,updated_at) VALUES(?,?,?,?,?)`,
      'c1', 'acct_01', 0, now, now
    );
    r.store.run(
      `INSERT INTO customers(customer_id,account_id,seas_flag,created_at,updated_at) VALUES(?,?,?,?,?)`,
      'c2', 'acct_01', 1, now, now
    );
    const cap = capacityOf(r, 'acct_01');
    expect(cap.used).toBe(1);
    expect(cap.remaining).toBe(499);
    r.close();
  });

  it('config 中的账号在启动时 seed 到 DB', () => {
    const home = mkdtempSync(join(tmpdir(), 'fuma-acc-'));
    // 先创建 config 并写入账号
    const first = createRuntime({ home, silentConsole: true });
    first.config.accounts.push({
      accountId: 'acct_cfg', name: 'cfg', ownerName: '.', loginMode: 'dingtalk_sso_qr',
      dingtalkOrg: 'x', fumaEnterprise: 'x', keepBrowserAlive: false, enabled: true
    });
    writeConfig(first.paths, first.config);
    first.close();
    const second = createRuntime({ home, silentConsole: true });
    expect(listAccounts(second).some((a) => a.accountId === 'acct_cfg')).toBe(true);
    second.close();
  });
});
