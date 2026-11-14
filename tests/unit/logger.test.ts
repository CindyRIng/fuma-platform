import { afterEach, describe, expect, it, vi } from 'vitest';
import { createLogger } from '../../src/core/logger.js';

describe('logger', () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it('console=false 时只写文件、不污染 stdout/stderr', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const logger = createLogger({ console: false });
    logger.info('hello');
    logger.error('boom');
    expect(log).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
  });

  it('console=true 时正常输出并脱敏敏感字段', () => {
    const log = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const logger = createLogger({ console: true });
    logger.info('login', { accessToken: 'secret-token' });
    expect(log).toHaveBeenCalledTimes(1);
    const line = String(log.mock.calls[0]?.[0] ?? '');
    expect(line).toContain('***');
    expect(line).not.toContain('secret-token');
  });
});
