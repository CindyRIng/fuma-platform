import type { Runtime } from './runtime.js';
import { processOutboxOnce, reconcileCustomers } from './sync.js';
import { processQueuedTasks } from './tasks.js';

/**
 * 后台调度：心跳保活 + 到期前重登检查。
 * 由 `fuma serve` 启动；CLI 单次命令不启动。
 */
export class Scheduler {
  private readonly rt: Runtime;
  private timers: NodeJS.Timeout[] = [];
  private readonly lastReloginAttempt = new Map<string, number>();
  private stopped = false;

  constructor(rt: Runtime) {
    this.rt = rt;
  }

  start(): void {
    const keepaliveMs = Math.max(30, this.rt.config.keepalive.intervalSeconds) * 1000;
    const reloginMs = Math.max(30, this.rt.config.login.reloginCheckIntervalSeconds) * 1000;
    const syncMs = Math.max(3, this.rt.config.sync.intervalSeconds) * 1000;
    const reconcileMs = Math.max(60, this.rt.config.sync.reconcileSeconds) * 1000;
    this.timers.push(setInterval(() => { void this.runHeartbeats(); }, keepaliveMs));
    this.timers.push(setInterval(() => { void this.runReloginChecks(); }, reloginMs));
    this.timers.push(setInterval(() => { void this.runSync(); }, syncMs));
    this.timers.push(setInterval(() => { void this.runTasks(); }, 5000));
    this.timers.push(setInterval(() => { void this.runReconcile(); }, reconcileMs));
    this.timers.push(setTimeout(() => { void this.runSync(); }, 2000));
    this.rt.logger.info('scheduler started', { keepaliveMs, reloginMs, syncMs, reconcileMs });
  }

  stop(): void {
    this.stopped = true;
    for (const t of this.timers) clearInterval(t);
    this.timers = [];
  }

  private async runHeartbeats(): Promise<void> {
    if (this.stopped) return;
    try {
      const accounts = this.rt.store.all<{ account_id: string }>('SELECT account_id FROM accounts WHERE enabled=1');
      for (const a of accounts) {
        try {
          const loaded = this.rt.sessions.loadTokens(a.account_id);
          if (!loaded) continue;
          const r = await this.rt.sessions.heartbeat(a.account_id);
          if (!r.ok) this.rt.logger.warn('heartbeat failed', { accountId: a.account_id, error: r.error });
        } catch (err) {
          this.rt.logger.warn('heartbeat error', { accountId: a.account_id, error: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      this.rt.logger.warn('heartbeat loop error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async runReloginChecks(): Promise<void> {
    if (this.stopped) return;
    try {
      const accounts = this.rt.store.all<{ account_id: string; status: string }>('SELECT account_id, status FROM accounts WHERE enabled=1');
      for (const a of accounts) {
        const accountId = a.account_id;
        try {
          if (!this.rt.sessions.needsRelogin(accountId)) continue;
          if (!this.rt.config.login.silentRelogin.enabled) {
            this.rt.logger.warn('token expiring soon (auto relogin disabled)', { accountId });
            continue;
          }
          const last = this.lastReloginAttempt.get(accountId) ?? 0;
          if (Date.now() - last < 10 * 60 * 1000) continue;
          this.lastReloginAttempt.set(accountId, Date.now());
          this.rt.logger.info('token expiring soon, starting relogin', { accountId });
          await this.rt.sessions.startLogin(accountId);
        } catch (err) {
          this.rt.logger.warn('relogin check error', { accountId, error: err instanceof Error ? err.message : String(err) });
        }
      }
    } catch (err) {
      this.rt.logger.warn('relogin loop error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async runSync(): Promise<void> {
    if (this.stopped) return;
    try {
      const r = await processOutboxOnce(this.rt, 10);
      if (r.processed > 0) this.rt.logger.info('outbox sync', r);
    } catch (err) {
      this.rt.logger.warn('sync loop error', { error: err instanceof Error ? err.message : String(err) });
    }
  }

  private async runTasks(): Promise<void> {
    if (this.stopped) return;
    try { await processQueuedTasks(this.rt, 3); } catch { /* ignore */ }
  }

  private async runReconcile(): Promise<void> {
    if (this.stopped) return;
    try {
      const accounts = this.rt.store.all<{ account_id: string }>('SELECT account_id FROM accounts WHERE enabled=1');
      for (const a of accounts) {
        if (!this.rt.sessions.loadTokens(a.account_id)) continue;
        const r = await reconcileCustomers(this.rt, a.account_id);
        this.rt.logger.info('reconcile', { accountId: a.account_id, checked: r.checked, diffs: r.diffs });
        break;
      }
    } catch (err) {
      this.rt.logger.warn('reconcile error', { error: err instanceof Error ? err.message : String(err) });
    }
  }
}
