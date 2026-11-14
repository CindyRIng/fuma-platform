import { AppError } from '../core/errors.js';
import { nowIso } from '../core/time.js';
import type { Runtime } from '../services/runtime.js';
import { capacityOf, getAccount } from '../services/accounts.js';
import { dedupCheck } from '../services/dedup.js';
import { getCustomer } from '../services/customers.js';

export interface RuleCheck {
  ok: boolean;
  reason?: string;
  details?: Record<string, unknown>;
}

export interface ClaimValidation extends RuleCheck {
  customer?: {
    customerId: string;
    custName: string;
    seasFlag: number;
  };
}

/** 领回冷却：同一账号对同一客户释放后 N 天内不可领取。 */
export function checkReleaseCooldown(rt: Runtime, accountId: string, customerId: string): RuleCheck {
  const days = rt.config.rules.releaseCooldownDays;
  const since = new Date(Date.now() - days * 86_400_000).toISOString();
  const row = rt.store.get<{ created_at: string }>(
    `SELECT created_at FROM capacity_ledger WHERE account_id=? AND customer_id=? AND reason='release' AND created_at>? ORDER BY id DESC LIMIT 1`,
    accountId, customerId, since
  );
  if (row) {
    return { ok: false, reason: 'cooldown_active', details: { accountId, customerId, releasedAt: row.created_at, cooldownDays: days } };
  }
  return { ok: true };
}

export function checkCapacity(rt: Runtime, accountId: string, need = 1): RuleCheck {
  const cap = capacityOf(rt, accountId);
  if (cap.used + need > cap.limit) {
    return { ok: false, reason: 'capacity_exceeded', details: { accountId, limit: cap.limit, used: cap.used, need } };
  }
  return { ok: true };
}

/**
 * 领取前校验（已确认规则）：
 * 1) 账号存在且启用
 * 2) 强制先查后领（查重命中→拒绝）
 * 3) 容量（默认 500，按角色规则解析后的 capacity_limit）
 * 4) 释放 3 天冷却
 * 5) 客户当前在公海
 */
export async function validateClaim(rt: Runtime, accountId: string, customerId: string): Promise<ClaimValidation> {
  const account = getAccount(rt, accountId);
  if (!account.enabled) return { ok: false, reason: 'account_disabled' };

  // 读取客户（本地缓存优先；无缓存则上游）
  let customer: { customerId: string; custName: string; seasFlag: number };
  try {
    const detail = await getCustomer(rt, { customerId, accountId });
    customer = { customerId: detail.customer.customerId, custName: detail.customer.custName, seasFlag: detail.customer.seasFlag };
  } catch (err) {
    if (err instanceof AppError && err.code === 'session_expired') return { ok: false, reason: 'session_expired' };
    throw err;
  }
  if (customer.seasFlag !== 1) {
    return { ok: false, reason: 'not_in_open_sea', details: { customerId, seasFlag: customer.seasFlag } };
  }

  // 强制先查后领
  if (rt.config.rules.requireDedupBeforeClaim && customer.custName) {
    const dedup = await dedupCheck(rt, { accountId, keywords: customer.custName });
    if (dedup.count > 0) {
      return { ok: false, reason: 'duplicate_customer', details: { customerId, custName: customer.custName, hits: dedup.count } };
    }
  }

  const cap = checkCapacity(rt, accountId);
  if (!cap.ok) return cap;

  const cd = checkReleaseCooldown(rt, accountId, customerId);
  if (!cd.ok) return cd;

  return { ok: true, customer };
}

export async function validateCreate(rt: Runtime, accountId: string): Promise<RuleCheck> {
  const account = getAccount(rt, accountId);
  if (!account.enabled) return { ok: false, reason: 'account_disabled' };
  return checkCapacity(rt, accountId);
}

export function recordCapacity(rt: Runtime, accountId: string, delta: number, reason: string, customerId: string): void {
  rt.store.run(
    `INSERT INTO capacity_ledger(account_id,delta,reason,customer_id,created_at) VALUES(?,?,?,?,?)`,
    accountId, delta, reason, customerId, nowIso()
  );
}
