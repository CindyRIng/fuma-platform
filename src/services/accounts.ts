import { AppError } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import type { Runtime } from './runtime.js';

export interface AccountRow {
  accountId: string;
  name: string;
  ownerName: string | null;
  ownerCtId: string | null;
  loginMode: string;
  dingtalkOrg: string | null;
  fumaEnterprise: string | null;
  capacityLimit: number;
  capacitySource: string;
  status: string;
  keepBrowserAlive: boolean;
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CapacityView {
  accountId: string;
  limit: number;
  used: number;
  remaining: number;
  source: string;
  lastSyncedAt: string | null;
}

function toAccount(row: Record<string, unknown>): AccountRow {
  return {
    accountId: String(row.account_id),
    name: String(row.name ?? ''),
    ownerName: (row.owner_name as string | null) ?? null,
    ownerCtId: (row.owner_ct_id as string | null) ?? null,
    loginMode: String(row.login_mode ?? 'dingtalk_sso_qr'),
    dingtalkOrg: (row.dingtalk_org as string | null) ?? null,
    fumaEnterprise: (row.fuma_enterprise as string | null) ?? null,
    capacityLimit: Number(row.capacity_limit ?? 500),
    capacitySource: String(row.capacity_source ?? 'default'),
    status: String(row.status ?? 'inactive'),
    keepBrowserAlive: Boolean(row.keep_browser_alive),
    enabled: Boolean(row.enabled),
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at)
  };
}

export function seedAccountsFromConfig(rt: Runtime): void {
  for (const acc of rt.config.accounts) {
    const existing = rt.store.get('SELECT account_id FROM accounts WHERE account_id=?', acc.accountId);
    if (existing) continue;
    const now = nowIso();
    rt.store.run(
      `INSERT INTO accounts(account_id,name,owner_name,owner_ct_id,login_mode,dingtalk_org,fuma_enterprise,capacity_limit,capacity_source,status,keep_browser_alive,enabled,created_at,updated_at)
       VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
      acc.accountId, acc.name, acc.ownerName || null, acc.ownerCtId ?? null, acc.loginMode,
      acc.dingtalkOrg, acc.fumaEnterprise, acc.capacityLimit ?? rt.config.rules.capacityPerAccount,
      acc.capacityLimit ? 'config' : 'default', 'inactive', acc.keepBrowserAlive ? 1 : 0, acc.enabled ? 1 : 0, now, now
    );
  }
}

export function listAccounts(rt: Runtime): AccountRow[] {
  return rt.store.all<Record<string, unknown>>('SELECT * FROM accounts ORDER BY created_at ASC').map(toAccount);
}

export function getAccount(rt: Runtime, accountId: string): AccountRow {
  const row = rt.store.get<Record<string, unknown>>('SELECT * FROM accounts WHERE account_id=?', accountId);
  if (!row) throw new AppError('not_found', `账号不存在: ${accountId}`, { details: { accountId } });
  return toAccount(row);
}

export interface CreateAccountInput {
  accountId: string;
  name?: string;
  ownerName?: string;
  ownerCtId?: string;
  loginMode?: string;
  dingtalkOrg?: string;
  fumaEnterprise?: string;
  capacityLimit?: number;
  keepBrowserAlive?: boolean;
}

export function createAccount(rt: Runtime, input: CreateAccountInput): AccountRow {
  if (!input.accountId) throw new AppError('invalid_argument', 'accountId 必填');
  const existing = rt.store.get('SELECT account_id FROM accounts WHERE account_id=?', input.accountId);
  if (existing) throw new AppError('conflict', `账号已存在: ${input.accountId}`);
  const now = nowIso();
  rt.store.run(
    `INSERT INTO accounts(account_id,name,owner_name,owner_ct_id,login_mode,dingtalk_org,fuma_enterprise,capacity_limit,capacity_source,status,keep_browser_alive,enabled,created_at,updated_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    input.accountId, input.name ?? '', input.ownerName ?? null, input.ownerCtId ?? null,
    input.loginMode ?? 'dingtalk_sso_qr', input.dingtalkOrg ?? rt.config.accounts[0]?.dingtalkOrg ?? null,
    input.fumaEnterprise ?? rt.config.accounts[0]?.fumaEnterprise ?? null,
    input.capacityLimit ?? rt.config.rules.capacityPerAccount, input.capacityLimit ? 'config' : 'default',
    'inactive', input.keepBrowserAlive ? 1 : 0, 1, now, now
  );
  return getAccount(rt, input.accountId);
}

export function updateAccount(rt: Runtime, accountId: string, patch: Partial<CreateAccountInput> & { status?: string; capacityLimit?: number; capacitySource?: string }): AccountRow {
  getAccount(rt, accountId);
  const fields: string[] = [];
  const values: unknown[] = [];
  const map: Record<string, string> = {
    name: 'name', ownerName: 'owner_name', ownerCtId: 'owner_ct_id', loginMode: 'login_mode',
    dingtalkOrg: 'dingtalk_org', fumaEnterprise: 'fuma_enterprise', capacityLimit: 'capacity_limit',
    capacitySource: 'capacity_source', status: 'status', keepBrowserAlive: 'keep_browser_alive'
  };
  for (const [k, col] of Object.entries(map)) {
    if (k in patch) {
      fields.push(`${col}=?`);
      const v = (patch as Record<string, unknown>)[k];
      values.push(typeof v === 'boolean' ? (v ? 1 : 0) : v);
    }
  }
  if (fields.length) {
    fields.push('updated_at=?');
    values.push(nowIso(), accountId);
    rt.store.run(`UPDATE accounts SET ${fields.join(',')} WHERE account_id=?`, ...values);
  }
  return getAccount(rt, accountId);
}

export function capacityOf(rt: Runtime, accountId: string): CapacityView {
  const acc = getAccount(rt, accountId);
  const row = rt.store.get<{ used: number }>(
    'SELECT COUNT(*) AS used FROM customers WHERE account_id=? AND seas_flag=0',
    accountId
  );
  const used = Number(row?.used ?? 0);
  const lastSync = rt.store.get<{ v: string }>('SELECT fetched_at AS v FROM capacity_rules ORDER BY fetched_at DESC LIMIT 1');
  return {
    accountId,
    limit: acc.capacityLimit,
    used,
    remaining: Math.max(0, acc.capacityLimit - used),
    source: acc.capacitySource,
    lastSyncedAt: lastSync?.v ?? null
  };
}

export function accountView(rt: Runtime, accountId: string): AccountRow & { capacity: CapacityView } {
  const acc = getAccount(rt, accountId);
  return { ...acc, capacity: capacityOf(rt, accountId) };
}
