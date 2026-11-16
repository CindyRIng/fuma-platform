import { mkdirSync } from 'node:fs';
import { resolve } from 'node:path';
import { AppError } from '../core/errors.js';
import { nowIso, secondsUntil } from '../core/time.js';
import type { Runtime } from '../services/runtime.js';
import { getAccount, updateAccount } from '../services/accounts.js';
import type { TokenPair } from '../upstream/client.js';
import { LoginBrowser } from './browser.js';
import type { QrSnapshot } from './browser.js';

function isAuthRedirect(url: string): boolean {
  try {
    const u = new URL(url);
    return /(^|\.)fumamx\.com$/.test(u.hostname) && u.pathname.startsWith('/thirdPartyAuthSuccess');
  } catch {
    return false;
  }
}

export type SessionState =
  | 'idle'
  | 'starting'
  | 'qr_ready'
  | 'scanned'
  | 'confirmed'
  | 'org_selected'
  | 'redirected'
  | 'enterprise_select'
  | 'online'
  | 'expired'
  | 'failed'
  | 'cancelled';

export interface SessionQrView {
  payload: string;
  pngBase64: string;
  ascii: string;
  expiresAt: string;
  refreshCount: number;
}

export interface SessionView {
  accountId: string;
  state: SessionState;
  mode: string;
  qr: SessionQrView | null;
  tokenExpiresAt: string | null;
  tokenRemainingSeconds: number | null;
  lastHeartbeatAt: string | null;
  lastError: string | null;
  startedAt: string | null;
  updatedAt: string;
  busy: boolean;
}

interface LiveSession {
  state: SessionState;
  mode: string;
  qr: SessionQrView | null;
  error: string | null;
  startedAt: string | null;
  tokenExpiresAt: string | null;
  busy: boolean;
  cancelRequested: boolean;
  browser: LoginBrowser | null;
  loginTask: Promise<void> | null;
}

interface StoredToken {
  value: string;
  expireTimeMs: number | null;
  ownerId: string | null;
  ctId: string | null;
  cid: string | null;
}

function parseToken(raw: string | null | undefined): StoredToken | null {
  if (!raw) return null;
  try {
    const j = JSON.parse(raw) as Record<string, unknown>;
    const value = typeof j.value === 'string' ? j.value : null;
    if (!value) return { value: raw, expireTimeMs: null, ownerId: null, ctId: null, cid: null };
    return {
      value,
      expireTimeMs: typeof j.expireTime === 'number' ? j.expireTime : null,
      ownerId: j.ownerId !== undefined ? String(j.ownerId) : null,
      ctId: j.ownerId !== undefined ? String(j.ownerId) : null,
      cid: j.cid !== undefined ? String(j.cid) : null
    };
  } catch {
    return { value: raw, expireTimeMs: null, ownerId: null, ctId: null, cid: null };
  }
}

export class SessionManager {
  private readonly live = new Map<string, LiveSession>();
  private readonly rt: Runtime;

  constructor(rt: Runtime) {
    this.rt = rt;
  }

  private liveOf(accountId: string): LiveSession {
    let s = this.live.get(accountId);
    if (!s) {
      s = { state: 'idle', mode: 'dingtalk_sso_qr', qr: null, error: null, startedAt: null, tokenExpiresAt: null, busy: false, cancelRequested: false, browser: null, loginTask: null };
      this.live.set(accountId, s);
    }
    return s;
  }

  private ensureRow(accountId: string): void {
    const row = this.rt.store.get('SELECT account_id FROM sessions WHERE account_id=?', accountId);
    if (!row) {
      this.rt.store.run(
        `INSERT INTO sessions(account_id,state,mode,qr_refresh_count,updated_at) VALUES(?,?,?,?,?)`,
        accountId, 'idle', 'dingtalk_sso_qr', 0, nowIso()
      );
    }
  }

  private persist(accountId: string, patch: Partial<{
    state: SessionState; mode: string; cId: number | null; ctId: number | null;
    accessTokenEnc: string | null; individualTokenEnc: string | null;
    tokenCreatedAt: number | null; tokenExpireAt: number | null;
    lastHeartbeatAt: string | null; lastError: string | null;
    qrPayload: string | null; qrExpiresAt: string | null; qrRefreshCount: number;
  }>): void {
    this.ensureRow(accountId);
    const fields: string[] = [];
    const values: unknown[] = [];
    const map: Record<string, string> = {
      state: 'state', mode: 'mode', cId: 'c_id', ctId: 'ct_id',
      accessTokenEnc: 'access_token_enc', individualTokenEnc: 'individual_token_enc',
      tokenCreatedAt: 'token_created_at', tokenExpireAt: 'token_expire_at',
      lastHeartbeatAt: 'last_heartbeat_at', lastError: 'last_error',
      qrPayload: 'qr_payload', qrExpiresAt: 'qr_expires_at', qrRefreshCount: 'qr_refresh_count'
    };
    for (const [k, col] of Object.entries(map)) {
      if (k in patch) {
        fields.push(`${col}=?`);
        values.push((patch as Record<string, unknown>)[k]);
      }
    }
    fields.push('updated_at=?');
    values.push(nowIso(), accountId);
    this.rt.store.run(`UPDATE sessions SET ${fields.join(',')} WHERE account_id=?`, ...values);
  }

  private setState(accountId: string, state: SessionState, opts: { error?: string | null } = {}): void {
    const s = this.liveOf(accountId);
    s.state = state;
    if (opts.error !== undefined) s.error = opts.error;
    if (state === 'online' || state === 'failed' || state === 'cancelled' || state === 'expired') s.busy = false;
    const patch: Record<string, unknown> = { state };
    if (opts.error !== undefined) patch.lastError = opts.error;
    this.persist(accountId, patch as never);
    this.rt.logger.info('session state changed', { accountId, state, error: opts.error ?? undefined });
  }

  async startLogin(accountId: string, mode = 'dingtalk_sso_qr'): Promise<SessionView> {
    this.rt.logger.info('startLogin entry', { accountId, mode, busy: this.liveOf(accountId).busy });
    const account = getAccount(this.rt, accountId);
    if (!account.enabled) throw new AppError('conflict', `账号已停用: ${accountId}`);
    const s = this.liveOf(accountId);
    if (s.busy) throw new AppError('account_busy', `账号登录进行中: ${accountId}`);
    s.busy = true;
    s.cancelRequested = false;
    s.error = null;
    s.qr = null;
    s.mode = mode;
    s.startedAt = nowIso();
    this.setState(accountId, 'starting');
    s.loginTask = this.runLogin(accountId, account.dingtalkOrg ?? this.rt.config.accounts[0]?.dingtalkOrg ?? '上海孚盟软件有限公司', account.fumaEnterprise ?? this.rt.config.accounts[0]?.fumaEnterprise ?? '上海孚盟软件有限公司')
      .catch((err) => {
        const msg = err instanceof AppError ? err.message : err instanceof Error ? err.message : String(err);
        if (s.state !== 'cancelled') this.setState(accountId, 'failed', { error: msg.slice(0, 500) });
        this.rt.logger.error('login failed', { accountId, error: msg.slice(0, 300) });
      })
      .finally(() => {
        s.busy = false;
        s.browser = null;
        s.loginTask = null;
      });
    return this.getView(accountId);
  }

  private async runLogin(accountId: string, dingtalkOrg: string, fumaEnterprise: string): Promise<void> {
    const s = this.liveOf(accountId);
    const profileDir = resolve(this.rt.paths.profilesDir, accountId);
    mkdirSync(profileDir, { recursive: true, mode: 0o700 });
    const browser = new LoginBrowser({ profileDir, headless: this.rt.config.login?.prewarm !== false ? true : true });
    s.browser = browser;
    const deadline = Date.now() + 10 * 60 * 1000;
    let refreshCount = 0;
    let lastPayload: string | null = null;
    let qrCapturedAt = 0;
    try {
      await browser.launch();
      this.rt.logger.info('browser launched', { accountId });
      await browser.openLoginPage();
      this.rt.logger.info('login page opened', { accountId });
      await browser.clickDingtalkAndWaitPopup();
      this.rt.logger.info('dingtalk popup opened', { accountId, url: browser.popup?.url()?.slice(0, 120) });
      this.setState(accountId, 'starting');

      let popupClosed = false;
      let scanned = false;
      let confirmed = false;
      while (Date.now() < deadline) {
        if (s.cancelRequested) {
          this.setState(accountId, 'cancelled');
          return;
        }
        const progress = await browser.scanProgress();
        popupClosed = progress.popupClosed;
        if (isAuthRedirect(progress.popupUrl) || popupClosed) break;
        if (progress.scanned || progress.confirmed) {
          scanned = progress.scanned;
          confirmed = progress.confirmed;
          if (s.state === 'qr_ready' || s.state === 'starting') this.setState(accountId, 'scanned');
          if (!confirmed) {
            const r = await browser.selectOrganization(dingtalkOrg);
            this.rt.logger.info('org select attempt', { accountId, ...r });
            // 选择后等待弹窗跳转/关闭
            for (let i = 0; i < 15; i++) {
              await new Promise((res) => setTimeout(res, 1000));
              const p = await browser.scanProgress();
              if (p.popupClosed || isAuthRedirect(p.popupUrl)) { popupClosed = true; break; }
              if (p.confirmed) { confirmed = true; break; }
              if (i === 3 || i === 8) await browser.selectOrganization(dingtalkOrg);
            }
            if (popupClosed) break;
          } else {
            this.setState(accountId, 'confirmed');
            for (let i = 0; i < 15; i++) {
              await new Promise((res) => setTimeout(res, 1000));
              const p = await browser.scanProgress();
              if (p.popupClosed || isAuthRedirect(p.popupUrl)) { popupClosed = true; break; }
              await browser.selectOrganization(dingtalkOrg).catch(() => undefined);
            }
            if (popupClosed) break;
          }
          continue;
        }

        const snap = await browser.captureQr();
        if (snap && snap.payload !== lastPayload) {
          lastPayload = snap.payload;
          qrCapturedAt = Date.now();
          refreshCount++;
          s.qr = {
            payload: snap.payload,
            pngBase64: snap.pngBase64,
            ascii: snap.ascii,
            expiresAt: new Date(Date.now() + 55_000).toISOString(),
            refreshCount
          };
          this.persist(accountId, {
            qrPayload: snap.payload,
            qrExpiresAt: s.qr.expiresAt,
            qrRefreshCount: refreshCount
          });
          this.setState(accountId, 'qr_ready');
        }
        // QR 过期或长时间无扫码 → reload 刷新
        const expired = qrCapturedAt > 0 && Date.now() - qrCapturedAt > 65_000;
        if (expired) {
          if (refreshCount >= this.rt.config.login.qrRefreshLimit) {
            throw new AppError('timeout', '二维码刷新次数超限，请重新登录');
          }
          await browser.reloadQr();
          qrCapturedAt = Date.now();
        }
        await new Promise((res) => setTimeout(res, 2000));
      }

      if (!popupClosed && !scanned) {
        this.rt.logger.info('login loop exited', { accountId, popupClosed, scanned, elapsedMs: Date.now() - (deadline - 600000) });
        throw new AppError('timeout', '等待扫码超时');
      }

      this.setState(accountId, 'redirected');
      // 孚盟企业选择
      for (let i = 0; i < 8; i++) {
        const sel = await browser.selectFumaEnterprise(fumaEnterprise).catch(() => ({ selected: false, entered: false }));
        if (sel.selected || sel.entered) {
          this.setState(accountId, 'enterprise_select');
          break;
        }
        await new Promise((res) => setTimeout(res, 2000));
      }
      const tokens = await browser.waitForWorkbenchTokens(120_000);
      if (!tokens) throw new AppError('timeout', '未获取到登录 token（可能企业选择未完成）');
      const a = parseToken(tokens.accessToken);
      const ind = parseToken(tokens.individualAccessToken);
      if (!a || !ind) throw new AppError('upstream_error', 'token 解析失败');
      const encA = this.rt.box.encrypt(a.value);
      const encI = this.rt.box.encrypt(ind.value);
      const tokenCreatedAt = Date.now();
      this.persist(accountId, {
        state: 'online',
        cId: a.cid ? Number(a.cid) : this.rt.config.upstream.companyId,
        ctId: a.ctId ? Number(a.ctId) : null,
        accessTokenEnc: encA,
        individualTokenEnc: encI,
        tokenCreatedAt,
        tokenExpireAt: a.expireTimeMs,
        lastError: null,
        qrPayload: null,
        qrExpiresAt: null
      });
      s.tokenExpiresAt = a.expireTimeMs ? new Date(a.expireTimeMs).toISOString() : null;
      s.qr = null;
      this.setState(accountId, 'online');
      updateAccount(this.rt, accountId, { status: 'active' });
    } finally {
      await browser.close().catch(() => undefined);
    }
  }

  getView(accountId: string): SessionView {
    this.ensureRow(accountId);
    const row = this.rt.store.get<Record<string, unknown>>('SELECT * FROM sessions WHERE account_id=?', accountId);
    const s = this.liveOf(accountId);
    let state = (row?.state as SessionState) ?? s.state;
    // 进程重启后，登录状态若没有活跃 loginTask 但有 token，则说明会话其实是有效的（陈旧 qr_ready/starting）
    const loginStates = new Set<SessionState>(['starting', 'scanned', 'confirmed', 'redirected', 'enterprise_select', 'qr_ready']);
    if (loginStates.has(state) && !s.busy && !s.loginTask && row?.access_token_enc) {
      this.persist(accountId, { state: 'online', qrPayload: null, qrExpiresAt: null, lastError: null });
      s.state = 'online';
      s.qr = null;
      state = 'online';
      if (row) { row.state = 'online'; row.qr_payload = null; row.qr_expires_at = null; row.last_error = null; }
    }
    const qr: SessionQrView | null = s.qr ?? (row?.qr_payload ? {
      payload: String(row.qr_payload),
      pngBase64: '',
      ascii: '',
      expiresAt: String(row.qr_expires_at ?? ''),
      refreshCount: Number(row.qr_refresh_count ?? 0)
    } : null);
    const tokenExpiresAt = row?.token_expire_at ? new Date(Number(row.token_expire_at)).toISOString() : s.tokenExpiresAt;
    return {
      accountId,
      state,
      mode: String(row?.mode ?? s.mode),
      qr,
      tokenExpiresAt,
      tokenRemainingSeconds: tokenExpiresAt ? secondsUntil(tokenExpiresAt) : null,
      lastHeartbeatAt: (row?.last_heartbeat_at as string | null) ?? null,
      lastError: (row?.last_error as string | null) ?? s.error,
      startedAt: s.startedAt,
      updatedAt: String(row?.updated_at ?? nowIso()),
      busy: s.busy
    };
  }

  async getQr(accountId: string): Promise<SessionQrView> {
    const s = this.liveOf(accountId);
    if (s.qr && s.qr.pngBase64) return s.qr;
    const view = this.getView(accountId);
    if (!view.qr?.payload) throw new AppError('not_found', '二维码尚未就绪');
    const { renderQr } = await import('./qr.js');
    const rendered = await renderQr(view.qr.payload);
    s.qr = { ...view.qr, ...rendered, refreshCount: view.qr.refreshCount };
    return s.qr;
  }

  async cancel(accountId: string): Promise<SessionView> {
    const s = this.liveOf(accountId);
    s.cancelRequested = true;
    if (s.browser) await s.browser.close().catch(() => undefined);
    s.browser = null;
    s.loginTask = null;
    s.busy = false;
    if (this.loadTokens(accountId)) {
      this.persist(accountId, { state: 'online', qrPayload: null, qrExpiresAt: null, lastError: null });
      s.state = 'online';
      s.qr = null;
    } else if (s.busy || ['starting', 'scanned', 'confirmed', 'redirected', 'enterprise_select', 'qr_ready'].includes(s.state)) {
      this.setState(accountId, 'idle');
      s.qr = null;
    }
    return this.getView(accountId);
  }

  async logout(accountId: string): Promise<SessionView> {
    const s = this.liveOf(accountId);
    s.cancelRequested = true;
    if (s.browser) await s.browser.close().catch(() => undefined);
    this.persist(accountId, {
      state: 'idle', accessTokenEnc: null, individualTokenEnc: null,
      tokenCreatedAt: null, tokenExpireAt: null, qrPayload: null, qrExpiresAt: null, lastError: null
    });
    s.state = 'idle';
    s.qr = null;
    s.tokenExpiresAt = null;
    updateAccount(this.rt, accountId, { status: 'inactive' });
    return this.getView(accountId);
  }

  loadTokens(accountId: string): { tokens: TokenPair; expiresAt: string | null; ctId: number | null; cId: number | null } | null {
    const row = this.rt.store.get<Record<string, unknown>>('SELECT * FROM sessions WHERE account_id=?', accountId);
    if (!row?.access_token_enc || !row?.individual_token_enc) return null;
    try {
      const accessToken = this.rt.box.decrypt(String(row.access_token_enc));
      const individualAccessToken = this.rt.box.decrypt(String(row.individual_token_enc));
      return {
        tokens: { accessToken, individualAccessToken },
        expiresAt: row.token_expire_at ? new Date(Number(row.token_expire_at)).toISOString() : null,
        ctId: row.ct_id ? Number(row.ct_id) : null,
        cId: row.c_id ? Number(row.c_id) : null
      };
    } catch {
      return null;
    }
  }

  /** 心跳探针：GET personalsettingGet（轻量只读）。 */
  async heartbeat(accountId: string): Promise<{ ok: boolean; latencyMs: number; error?: string }> {
    const loaded = this.loadTokens(accountId);
    if (!loaded) {
      this.persist(accountId, { state: 'expired', lastError: '无本地 token' });
      this.liveOf(accountId).state = 'expired';
      return { ok: false, latencyMs: 0, error: 'session_expired' };
    }
    const started = Date.now();
    try {
      await this.rt.upstream.call(
        { accountId, tokens: loaded.tokens, logger: this.rt.logger },
        { method: 'GET', path: '/UniversalInterface/personalsettingGet', timeoutMs: this.rt.config.keepalive.timeoutMs }
      );
      const latency = Date.now() - started;
      this.rt.store.run('INSERT INTO session_health(account_id,checked_at,ok,latency_ms,error) VALUES(?,?,?,?,?)', accountId, nowIso(), 1, latency, null);
      const live = this.liveOf(accountId);
      if (!live.busy && !live.loginTask && live.state !== 'online') {
        this.persist(accountId, { state: 'online', qrPayload: null, qrExpiresAt: null, lastError: null });
        live.state = 'online';
        live.qr = null;
      }
      this.persist(accountId, { lastHeartbeatAt: nowIso() });
      this.extendLocalExpiryAfterActivity(accountId, loaded.expiresAt);
      return { ok: true, latencyMs: latency };
    } catch (err) {
      const app = err instanceof AppError ? err : new AppError('upstream_error', String(err));
      this.rt.store.run('INSERT INTO session_health(account_id,checked_at,ok,latency_ms,error) VALUES(?,?,?,?,?)', accountId, nowIso(), 0, Date.now() - started, app.message.slice(0, 300));
      this.persist(accountId, { lastHeartbeatAt: nowIso(), lastError: app.message.slice(0, 300) });
      if (app.code === 'session_expired') {
        this.persist(accountId, { state: 'expired' });
        this.liveOf(accountId).state = 'expired';
      }
      return { ok: false, latencyMs: Date.now() - started, error: app.code };
    }
  }

  /**
   * 实测（2026-11-16）：上游 token 名义 24h 过期后，只要期间有活动（心跳），请求仍可用；
   * 因此心跳成功且本地有效期临近/已过期时，按活动续期估算刷新本地 token_expire_at，避免误触发重登。
   */
  private extendLocalExpiryAfterActivity(accountId: string, expiresAt: string | null): void {
    const leadMs = Math.max(1, this.rt.config.login.reloginLeadMinutes) * 60_000;
    if (expiresAt) {
      const remainingMs = Date.parse(expiresAt) - Date.now();
      if (remainingMs > leadMs) return;
    }
    const ttlHours = Math.max(1, this.rt.config.keepalive.tokenTtlHours);
    const next = Date.now() + ttlHours * 3600_000;
    this.rt.store.run('UPDATE sessions SET token_expire_at=?, updated_at=? WHERE account_id=?', next, nowIso(), accountId);
    const s = this.liveOf(accountId);
    s.tokenExpiresAt = new Date(next).toISOString();
    this.rt.logger.info('token expiry extended after heartbeat activity', { accountId, previousExpiresAt: expiresAt, newExpiresAt: s.tokenExpiresAt, ttlHours });
  }

  listViews(): SessionView[] {
    const ids = this.rt.store.all<{ account_id: string }>('SELECT account_id FROM accounts ORDER BY created_at ASC').map((r) => r.account_id);
    return ids.map((id) => this.getView(id));
  }

  /** 是否需要重登（token 剩余时间低于阈值） */
  needsRelogin(accountId: string, leadMinutes = this.rt.config.login.reloginLeadMinutes): boolean {
    const loaded = this.loadTokens(accountId);
    if (!loaded) return false;
    if (!loaded.expiresAt) return false;
    return secondsUntil(loaded.expiresAt) < leadMinutes * 60;
  }

  async reloginIfNeeded(accountId: string): Promise<boolean> {
    if (!this.needsRelogin(accountId)) return false;
    const s = this.liveOf(accountId);
    if (s.busy) return false;
    await this.startLogin(accountId);
    return true;
  }

  /** 等待状态满足条件（CLI 交互用）。 */
  async waitForState(accountId: string, states: SessionState[], timeoutMs: number): Promise<SessionView> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const view = this.getView(accountId);
      if (states.includes(view.state)) return view;
      await new Promise((r) => setTimeout(r, 1500));
    }
    return this.getView(accountId);
  }
}
