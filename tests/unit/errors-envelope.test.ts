import { describe, expect, it } from 'vitest';
import { errorEnvelope, httpStatusOf, okEnvelope } from '../../src/api/envelope.js';
import { AppError, ERROR_SPECS, toAppError, UpstreamError } from '../../src/core/errors.js';

const meta = { requestId: 'req_test', specVersion: 'test' };

describe('envelope / errors', () => {
  it('ok envelope 结构', () => {
    const env = okEnvelope({ a: 1 }, meta);
    expect(env).toMatchObject({ ok: true, data: { a: 1 }, error: null });
    expect(env.meta.requestId).toBe('req_test');
    expect(env.meta.durationMs).toBe(0);
  });

  it('error envelope 映射错误码/可重试性', () => {
    const env = errorEnvelope(new AppError('capacity_exceeded', '满了'), meta);
    expect(env.ok).toBe(false);
    expect(env.error?.code).toBe('capacity_exceeded');
    expect(env.error?.retryable).toBe(false);
  });

  it('http 状态映射', () => {
    expect(httpStatusOf(new AppError('unauthorized'))).toBe(401);
    expect(httpStatusOf(new AppError('session_expired'))).toBe(401);
    expect(httpStatusOf(new AppError('upstream_error'))).toBe(502);
    expect(httpStatusOf(new Error('x'))).toBe(500);
  });

  it('upstream 错误保留 traceId/retryable', () => {
    const u = new UpstreamError('busy', { upstreamCode: '-1', traceId: 't1', retryable: true });
    expect(u.code).toBe('upstream_error');
    expect(u.retryable).toBe(true);
    expect(u.upstreamCode).toBe('-1');
    expect(u.traceId).toBe('t1');
  });

  it('toAppError 将普通 Error 收敛为 internal_error', () => {
    expect(toAppError(new Error('boom')).code).toBe('internal_error');
    expect(ERROR_SPECS.internal_error.http).toBe(500);
  });
});
