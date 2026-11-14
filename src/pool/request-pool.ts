import { AppError } from '../core/errors.js';
import type { Runtime } from '../services/runtime.js';
import type { TokenPair } from '../upstream/client.js';

export interface ReadContext {
  accountId: string;
  tokens: TokenPair;
}

export interface PoolStats {
  inflight: Record<string, number>;
  lastCallAt: Record<string, string>;
}

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

/**
 * 请求池（P4 最小实现）：
 * - 读任务可路由到任一有 token 的在线账号（可按 accountId 指定）
 * - 写任务必须指定账号
 * - 账号级串行队列 + 简单 QPS 间隔 + 抖动
 * 注：更复杂的 token bucket/熔断在 P6 调优时增强。
 */
export class RequestPool {
  private readonly rt: Runtime;
  private readonly chains = new Map<string, Promise<unknown>>();
  private readonly lastCall = new Map<string, number>();
  private readonly inflight = new Map<string, number>();

  constructor(rt: Runtime) {
    this.rt = rt;
  }

  resolveReadAccount(accountId?: string): ReadContext {
    const candidates = this.rt.store.all<{ account_id: string }>('SELECT account_id FROM accounts WHERE enabled=1 ORDER BY created_at ASC');
    const ids = candidates.map((c) => c.account_id);
    const pick = accountId ?? ids.find((id) => this.rt.sessions.loadTokens(id) !== null);
    if (!pick) throw new AppError('session_expired', '没有可用账号（均无 token），请先登录');
    if (accountId && !ids.includes(accountId)) throw new AppError('not_found', `账号不存在: ${accountId}`);
    const loaded = this.rt.sessions.loadTokens(pick);
    if (!loaded) throw new AppError('session_expired', `账号 ${pick} 无有效会话，请先登录`, { details: { accountId: pick } });
    return { accountId: pick, tokens: loaded.tokens };
  }

  resolveWriteAccount(accountId: string): ReadContext {
    if (!accountId) throw new AppError('invalid_argument', '写操作必须指定 accountId');
    const loaded = this.rt.sessions.loadTokens(accountId);
    if (!loaded) throw new AppError('session_expired', `账号 ${accountId} 无有效会话，请先登录`, { details: { accountId } });
    return { accountId, tokens: loaded.tokens };
  }

  private async throttle(accountId: string, kind: 'read' | 'write'): Promise<void> {
    const base = kind === 'read' ? this.rt.config.pool.ratePerSecond.read : this.rt.config.pool.ratePerSecond.write;
    const qps = Math.max(0.1, base);
    const interval = 1000 / qps;
    const [jMin, jMax] = this.rt.config.pool.jitterMs;
    const jitter = jMin + Math.random() * Math.max(0, jMax - jMin);
    const last = this.lastCall.get(`${accountId}:${kind}`) ?? 0;
    const wait = Math.max(0, last + interval + jitter - Date.now());
    if (wait > 0) await sleep(wait);
    this.lastCall.set(`${accountId}:${kind}`, Date.now());
  }

  async runRead<T>(accountId: string | undefined, fn: (ctx: ReadContext) => Promise<T>): Promise<T> {
    const ctx = this.resolveReadAccount(accountId);
    return this.enqueue(ctx.accountId, async () => {
      await this.throttle(ctx.accountId, 'read');
      return fn(ctx);
    });
  }

  async runWrite<T>(accountId: string, fn: (ctx: ReadContext) => Promise<T>): Promise<T> {
    const ctx = this.resolveWriteAccount(accountId);
    return this.enqueue(ctx.accountId, async () => {
      await this.throttle(ctx.accountId, 'write');
      return fn(ctx);
    });
  }

  private enqueue<T>(accountId: string, task: () => Promise<T>): Promise<T> {
    const prev = (this.chains.get(accountId) ?? Promise.resolve()) as Promise<unknown>;
    this.inflight.set(accountId, (this.inflight.get(accountId) ?? 0) + 1);
    const next = prev.then(task, task).finally(() => {
      const n = (this.inflight.get(accountId) ?? 1) - 1;
      this.inflight.set(accountId, Math.max(0, n));
      if (n <= 0) this.chains.delete(accountId);
    });
    this.chains.set(accountId, next);
    return next as Promise<T>;
  }

  stats(): PoolStats {
    return {
      inflight: Object.fromEntries(this.inflight),
      lastCallAt: Object.fromEntries([...this.lastCall.entries()].map(([k, v]) => [k, new Date(v).toISOString()]))
    };
  }
}

const pools = new WeakMap<Runtime, RequestPool>();

export function poolOf(rt: Runtime): RequestPool {
  let p = pools.get(rt);
  if (!p) {
    p = new RequestPool(rt);
    pools.set(rt, p);
  }
  return p;
}
