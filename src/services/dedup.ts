import { sha256Hex } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';

export interface DedupCheckInput {
  accountId?: string;
  keywords: string;
  moduleCode?: string;
  type?: string;
  ignore?: boolean;
  querySuffix?: boolean;
  mutual?: boolean;
  fieldId?: string;
}

export interface DedupCheckResult {
  count: number;
  keywords: string;
  moduleCode: string;
  checkedAt: string;
  snapshotId: number | null;
}

/** 单条查重：POST /bill/repeat/check（实测 body 见 docs/03）。 */
export async function dedupCheck(rt: Runtime, input: DedupCheckInput): Promise<DedupCheckResult> {
  const keywords = String(input.keywords ?? '').trim();
  if (!keywords) throw new Error('keywords 必填');
  const moduleCode = input.moduleCode ?? 'NewBF001';
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  const body: Record<string, unknown> = {
    size: 6,
    from: 0,
    type: input.type ?? '1',
    moduleCode,
    keywords,
    ignore: input.ignore ?? true,
    querySuffix: input.querySuffix ?? true,
    mutual: input.mutual ?? true
  };
  if (input.fieldId) body.fieldId = input.fieldId;
  const data = await pool.runRead(account.accountId, (ctx) => rt.upstream.call<{ count?: string | number }>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'POST', path: '/bill/repeat/check', body
  }));
  const count = Number(data.count ?? 0);
  const checkedAt = nowIso();
  const hash = sha256Hex(JSON.stringify({ keywords, moduleCode }));
  rt.store.run(
    `INSERT INTO dedup_snapshots(keywords,keywords_hash,module_code,hit_count,checked_at,checked_by_account)
     VALUES(?,?,?,?,?,?)
     ON CONFLICT(keywords_hash,module_code) DO UPDATE SET hit_count=excluded.hit_count, checked_at=excluded.checked_at, checked_by_account=excluded.checked_by_account`,
    keywords, hash, moduleCode, count, checkedAt, account.accountId
  );
  const row = rt.store.get<{ id: number }>('SELECT id FROM dedup_snapshots WHERE keywords_hash=? AND module_code=?', hash, moduleCode);
  return { count, keywords, moduleCode, checkedAt, snapshotId: row?.id ?? null };
}

export interface DedupHistoryInput {
  accountId?: string;
  moduleCode?: string;
  size?: number | string;
}

export async function dedupHistory(rt: Runtime, input: DedupHistoryInput): Promise<unknown> {
  const moduleCode = input.moduleCode ?? 'NewBF001';
  const size = Math.min(50, Math.max(1, Number(input.size ?? 5) || 5));
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  return pool.runRead(account.accountId, (ctx) => rt.upstream.call({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: 'GET', path: '/bill/repeat/getHistory', query: { moduleCode, size }
  }));
}
