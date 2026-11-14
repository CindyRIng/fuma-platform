import { AppError, UpstreamError } from '../core/errors.js';
import { newId } from '../core/ids.js';

export interface TokenPair {
  accessToken: string;
  individualAccessToken: string;
}

export interface UpstreamOptions {
  baseUrl: string;
  pcapiPrefix: string;
  companyId: number;
  timeoutMs: number;
  userAgent: string;
  language: string;
}

export interface UpstreamRequest {
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  query?: Record<string, unknown>;
  body?: Record<string, unknown>;
  /** 是否注入 token（登录类接口不需要） */
  withAuth?: boolean;
  timeoutMs?: number;
  retry?: { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number };
}

interface UpstreamEnvelope<T> {
  code?: string | number;
  data?: T;
  msg?: string;
  message?: string;
  traceId?: string;
  ApiTime?: number;
  version?: string;
  releaseVersion?: number;
  serverMsgs?: Array<{ serverName?: string; method?: string; errorMsg?: string }>;
}

export interface CallContext {
  accountId: string;
  tokens: TokenPair | null;
  logger?: { debug(msg: string, extra?: Record<string, unknown>): void; warn(msg: string, extra?: Record<string, unknown>): void };
}

const DEFAULT_RETRY = { maxAttempts: 3, baseDelayMs: 1000, maxDelayMs: 60_000 };

function sleep(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

function encodeQuery(params: Record<string, unknown>): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null) continue;
    if (Array.isArray(v)) {
      for (const item of v) sp.append(k, String(item));
    } else if (typeof v === 'object') {
      sp.append(k, JSON.stringify(v));
    } else {
      sp.append(k, String(v));
    }
  }
  return sp.toString();
}

/**
 * 孚盟业务 API 客户端：
 * - GET 参数走 query，POST 参数走 body（实测约定）
 * - 注入 accessToken/individualAccessToken + 公共参数
 * - 错误码映射（-1 重试 / -2 会话失效 / 1004 上游异常）
 */
export class UpstreamClient {
  readonly opts: UpstreamOptions;
  private readonly fetchImpl: typeof fetch;

  constructor(opts: UpstreamOptions, fetchImpl: typeof fetch = fetch) {
    this.opts = opts;
    this.fetchImpl = fetchImpl;
  }

  private commonParams(ctx: CallContext): Record<string, unknown> {
    const params: Record<string, unknown> = {
      event_source: 'MX',
      operating_terminal: 'pc_网页端',
      languageForMX5: this.opts.language,
      isV5: true,
      isV5AndNewMail: true,
      _filterCompanyId: this.opts.companyId,
      isNewArchCompany: true
    };
    if (ctx.tokens) {
      params.accessToken = ctx.tokens.accessToken;
      params.individualAccessToken = ctx.tokens.individualAccessToken;
    }
    return params;
  }

  async call<T = unknown>(ctx: CallContext, req: UpstreamRequest): Promise<T> {
    const withAuth = req.withAuth !== false;
    const retry = { ...DEFAULT_RETRY, ...(req.retry ?? {}) };
    const timeoutMs = req.timeoutMs ?? this.opts.timeoutMs;
    const urlPath = req.path.startsWith('/') ? req.path : `/${req.path}`;
    const base = `${this.opts.baseUrl.replace(/\/$/, '')}${this.opts.pcapiPrefix}${urlPath}`;
    let lastErr: unknown;

    for (let attempt = 1; attempt <= retry.maxAttempts; attempt++) {
      const traceId = newId('trace').replace('trace_', '');
      const params = withAuth ? this.commonParams(ctx) : {};
      const query = req.method === 'GET'
        ? encodeQuery({ ...params, ...(req.query ?? {}), '_@#time': Date.now() })
        : encodeQuery({ ...(req.query ?? {}) });
      const url = query ? `${base}?${query}` : base;
      const headers: Record<string, string> = {
        accept: 'application/json, text/plain, */*',
        'x-requested-with': 'XMLHttpRequest',
        referer: `${this.opts.baseUrl}/`,
        'user-agent': this.opts.userAgent,
        'x-trace-id': traceId.slice(0, 32)
      };
      let body: string | undefined;
      if (req.method === 'GET') {
        headers.accept = 'application/json, text/plain, */*';
      } else {
        headers['content-type'] = 'application/json;charset=UTF-8';
        body = JSON.stringify(withAuth ? { ...params, ...(req.body ?? {}) } : { ...(req.body ?? {}) });
      }

      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), timeoutMs);
      try {
        const res = await this.fetchImpl(url, { method: req.method, headers, body, signal: controller.signal, redirect: 'follow' });
        const text = await res.text();
        let env: UpstreamEnvelope<T> | null = null;
        try { env = JSON.parse(text) as UpstreamEnvelope<T>; } catch { env = null; }

        if (!res.ok) {
          throw new UpstreamError(`HTTP ${res.status}`, { retryable: res.status >= 500 || res.status === 429, details: { status: res.status, url: urlPath } });
        }
        if (!env || env.code === undefined) {
          throw new UpstreamError(`响应格式异常（无 code）: ${text.slice(0, 200)}`, { retryable: false, details: { url: urlPath } });
        }
        const code = String(env.code);
        if (code === '0') return env.data as T;

        if (code === '-2') {
          throw new AppError('session_expired', '上游会话失效（code=-2）', { details: { accountId: ctx.accountId } });
        }
        if (code === '-1') {
          lastErr = new UpstreamError(env.msg ?? '系统繁忙（-1）', { upstreamCode: code, traceId: env.traceId, retryable: true, details: { url: urlPath } });
          ctx.logger?.warn('upstream busy (-1)', { url: urlPath, attempt });
        } else if (code === '1004') {
          const msg = (env.serverMsgs ?? []).map((m) => m.errorMsg).filter(Boolean).join(' | ').slice(0, 500) || env.msg || '上游微服务异常（1004）';
          throw new UpstreamError(msg, { upstreamCode: code, traceId: env.traceId, retryable: false, details: { url: urlPath } });
        } else if (code === '1007') {
          throw new UpstreamError(env.msg ?? '上游业务错误（1007）', { upstreamCode: code, traceId: env.traceId, retryable: false });
        } else {
          const serverMsgs = (env.serverMsgs ?? []).map((m) => String(m.errorMsg ?? m.serverName ?? "")).filter(Boolean).join(" | ");
          const rawMsg = env.msg ?? env.message;
          const detailMsg = typeof rawMsg === "string" ? rawMsg : rawMsg !== undefined ? JSON.stringify(rawMsg).slice(0, 800) : "";
          const message = `上游错误 code=${code}${detailMsg ? ` msg=${detailMsg}` : ""}${serverMsgs ? ` server=${serverMsgs.slice(0, 1200)}` : ""}`;
          throw new UpstreamError(message, { upstreamCode: code, traceId: env.traceId, retryable: false });
        }
      } catch (err) {
        if (err instanceof AppError && (err.code === 'session_expired' || err.code === 'upstream_error' && !(err as UpstreamError).retryable)) throw err;
        lastErr = err;
        if (attempt >= retry.maxAttempts) break;
        const delay = Math.min(retry.baseDelayMs * 2 ** (attempt - 1), retry.maxDelayMs);
        ctx.logger?.warn('upstream retry', { url: urlPath, attempt, delayMs: delay });
        await sleep(delay);
      } finally {
        clearTimeout(timer);
      }
    }
    if (lastErr instanceof AppError) throw lastErr;
    throw new UpstreamError(lastErr instanceof Error ? lastErr.message : String(lastErr), { retryable: true });
  }
}
