import { AppError, ERROR_SPECS, toAppError, type ErrorCode } from '../core/errors.js';

export interface EnvelopeMeta {
  requestId: string;
  specVersion: string;
  durationMs: number;
  accountId?: string;
  [k: string]: unknown;
}

export type MetaInput = {
  requestId: string;
  specVersion: string;
  durationMs?: number;
  accountId?: string;
  [k: string]: unknown;
};

export interface Envelope<T = unknown> {
  ok: boolean;
  data: T | null;
  meta: EnvelopeMeta;
  error: null | {
    code: ErrorCode;
    message: string;
    retryable: boolean;
    details?: Record<string, unknown>;
    retryAfterMs?: number;
  };
}

export function okEnvelope<T>(data: T, meta: MetaInput): Envelope<T> {
  const out: EnvelopeMeta = { ...meta, durationMs: meta.durationMs ?? 0, requestId: meta.requestId, specVersion: meta.specVersion };
  return { ok: true, data, meta: out, error: null };
}

export function errorEnvelope(err: unknown, meta: MetaInput): Envelope<never> {
  const app = toAppError(err);
  const out: EnvelopeMeta = { ...meta, durationMs: meta.durationMs ?? 0, requestId: meta.requestId, specVersion: meta.specVersion };
  return {
    ok: false,
    data: null,
    meta: out,
    error: {
      code: app.code,
      message: app.message,
      retryable: app.retryable,
      ...(app.details ? { details: app.details } : {}),
      ...(app.retryAfterMs ? { retryAfterMs: app.retryAfterMs } : {})
    }
  };
}

export function httpStatusOf(err: unknown): number {
  const app = toAppError(err);
  return ERROR_SPECS[app.code]?.http ?? 500;
}

export function isAppErrorLike(err: unknown): err is AppError {
  return err instanceof AppError;
}
