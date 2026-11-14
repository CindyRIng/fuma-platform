import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { createAccount } from '../../src/services/accounts.js';
import { poolOf } from '../../src/pool/request-pool.js';

function setup() {
  const home = mkdtempSync(join(tmpdir(), 'fuma-pool-'));
  const rt = createRuntime({ home, silentConsole: true });
  createAccount(rt, { accountId: 'acct_01' });
  return rt;
}

describe('RequestPool', () => {
  it('无 token 时读任务报 session_expired', () => {
    const rt = setup();
    expect(() => poolOf(rt).resolveReadAccount()).toThrow(/没有可用账号|无有效会话/);
    rt.close();
  });

  it('指定账户无 token 报 session_expired；不存在报 not_found', () => {
    const rt = setup();
    expect(() => poolOf(rt).resolveReadAccount('acct_01')).toThrow(/无有效会话/);
    expect(() => poolOf(rt).resolveReadAccount('ghost')).toThrow(/不存在/);
    rt.close();
  });

  it('写入必须显式 accountId', () => {
    const rt = setup();
    expect(() => poolOf(rt).resolveWriteAccount('')).toThrow(/必须指定/);
    rt.close();
  });
});
