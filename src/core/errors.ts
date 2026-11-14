/**
 * 统一错误模型：平台错误码与 HTTP 状态、可重试性、脱敏消息。
 */
export type ErrorCode =
  | 'invalid_argument'
  | 'unauthorized'
  | 'not_found'
  | 'conflict'
  | 'capacity_exceeded'
  | 'cooldown_active'
  | 'duplicate_customer'
  | 'permission_denied'
  | 'session_expired'
  | 'account_busy'
  | 'upstream_error'
  | 'rate_limited'
  | 'task_cancelled'
  | 'timeout'
  | 'not_implemented'
  | 'internal_error';

export interface ErrorSpec {
  http: number;
  retryable: boolean;
  message: string;
}

export const ERROR_SPECS: Record<ErrorCode, ErrorSpec> = {
  invalid_argument: { http: 400, retryable: false, message: '参数错误' },
  unauthorized: { http: 401, retryable: false, message: '入口鉴权失败' },
  not_found: { http: 404, retryable: false, message: '资源不存在' },
  conflict: { http: 409, retryable: false, message: '状态或幂等键冲突' },
  capacity_exceeded: { http: 409, retryable: false, message: '账号保护容量已满' },
  cooldown_active: { http: 409, retryable: false, message: '释放后冷却期内不可领取' },
  duplicate_customer: { http: 409, retryable: false, message: '查重命中/重复建档' },
  permission_denied: { http: 403, retryable: false, message: '上游权限不足' },
  session_expired: { http: 401, retryable: true, message: '账号会话过期/失效' },
  account_busy: { http: 429, retryable: true, message: '账号繁忙/被限流' },
  upstream_error: { http: 502, retryable: false, message: '上游业务/系统错误' },
  rate_limited: { http: 429, retryable: true, message: '池级限流' },
  task_cancelled: { http: 409, retryable: false, message: '任务已取消' },
  timeout: { http: 504, retryable: true, message: '超时' },
  not_implemented: { http: 501, retryable: false, message: '能力尚未实现' },
  internal_error: { http: 500, retryable: false, message: '平台内部错误' }
};

export class AppError extends Error {
  readonly code: ErrorCode;
  readonly retryable: boolean;
  readonly details?: Record<string, unknown>;
  readonly retryAfterMs?: number;

  constructor(code: ErrorCode, message?: string, opts: { details?: Record<string, unknown>; retryAfterMs?: number; cause?: unknown } = {}) {
    super(message ?? ERROR_SPECS[code].message);
    this.name = 'AppError';
    this.code = code;
    this.retryable = ERROR_SPECS[code].retryable;
    this.details = opts.details;
    this.retryAfterMs = opts.retryAfterMs;
    if (opts.cause !== undefined) (this as { cause?: unknown }).cause = opts.cause;
  }
}

export class UpstreamError extends AppError {
  readonly upstreamCode?: string | number;
  readonly traceId?: string;

  constructor(message: string, opts: { upstreamCode?: string | number; traceId?: string; retryable?: boolean; details?: Record<string, unknown>; cause?: unknown } = {}) {
    super('upstream_error', message, { details: opts.details, cause: opts.cause });
    this.name = 'UpstreamError';
    this.upstreamCode = opts.upstreamCode;
    this.traceId = opts.traceId;
    if (opts.retryable !== undefined) (this as { retryable: boolean }).retryable = opts.retryable;
  }
}

export function isAppError(err: unknown): err is AppError {
  return err instanceof AppError;
}

export function toAppError(err: unknown): AppError {
  if (err instanceof AppError) return err;
  if (err instanceof Error) {
    const code = (err as NodeJS.ErrnoException).code;
    if (code === 'ETIMEDOUT' || /timeout/i.test(err.message)) return new AppError('timeout', err.message, { cause: err });
    return new AppError('internal_error', err.message, { cause: err });
  }
  return new AppError('internal_error', String(err));
}
