import { loadConfig, type Config, type Paths } from '../config.js';
import { SecretBox } from '../core/crypto.js';
import { createLogger, type Logger } from '../core/logger.js';
import { openStore, type Store } from '../core/store.js';
import { UpstreamClient } from '../upstream/client.js';
import { SessionManager } from '../auth/session-manager.js';
import { seedAccountsFromConfig } from './accounts.js';

export interface Runtime {
  config: Config;
  paths: Paths;
  store: Store;
  logger: Logger;
  box: SecretBox;
  upstream: UpstreamClient;
  sessions: SessionManager;
  close(): void;
}

export interface RuntimeOptions {
  home?: string;
  createIfMissing?: boolean;
  loggerLevel?: 'debug' | 'info' | 'warn' | 'error';
  silentConsole?: boolean;
}

let cached: Runtime | null = null;

export function createRuntime(opts: RuntimeOptions = {}): Runtime {
  const { config, paths } = loadConfig({ home: opts.home, createIfMissing: opts.createIfMissing ?? true });
  const logger = createLogger({ level: opts.loggerLevel ?? config.logging.level, file: paths.logFile, redact: config.logging.redact, console: opts.silentConsole === true ? false : true });
  const store = openStore(paths.dbFile);
  const box = new SecretBox(paths.secretKeyFile);
  const upstream = new UpstreamClient({
    baseUrl: config.upstream.baseUrl,
    pcapiPrefix: config.upstream.pcapiPrefix,
    companyId: config.upstream.companyId,
    timeoutMs: config.upstream.timeoutMs,
    userAgent: config.upstream.userAgent,
    language: config.upstream.language
  });
  const runtime = {
    config,
    paths,
    store,
    logger,
    box,
    upstream
  } as unknown as Runtime;
  runtime.sessions = new SessionManager(runtime);
  runtime.close = () => {
    try { store.close(); } catch { /* ignore */ }
  };
  seedAccountsFromConfig(runtime);
  return runtime;
}

export function getRuntime(opts: RuntimeOptions = {}): Runtime {
  if (!cached) cached = createRuntime(opts);
  return cached;
}

export function closeRuntime(): void {
  if (cached) {
    cached.close();
    cached = null;
  }
}
