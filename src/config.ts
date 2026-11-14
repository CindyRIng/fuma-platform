import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { z } from 'zod';
import { newSecret } from './core/ids.js';

const AccountConfigSchema = z.object({
  accountId: z.string().min(1),
  name: z.string().default(''),
  ownerName: z.string().default(''),
  ownerCtId: z.string().optional(),
  loginMode: z.enum(['dingtalk_sso_qr', 'password_slider_dingtalk', 'manual_token']).default('dingtalk_sso_qr'),
  dingtalkOrg: z.string().default('上海孚盟软件有限公司'),
  fumaEnterprise: z.string().default('上海孚盟软件有限公司'),
  capacityLimit: z.number().int().positive().optional(),
  keepBrowserAlive: z.boolean().default(false),
  enabled: z.boolean().default(true)
});

export const ConfigSchema = z.object({
  server: z.object({
    restHost: z.string().default('127.0.0.1'),
    restPort: z.number().int().min(1024).max(65535).default(17890),
    apiToken: z.string().default('')
  }).prefault({}),
  paths: z.object({
    home: z.string().default(''),
    dbFile: z.string().default(''),
    logFile: z.string().default(''),
    profilesDir: z.string().default(''),
    backupDir: z.string().default('')
  }).prefault({}),
  upstream: z.object({
    baseUrl: z.string().default('https://www.fumamx.com'),
    pcapiPrefix: z.string().default('/pcapi'),
    companyId: z.number().int().default(10264),
    timeoutMs: z.number().int().default(20_000),
    userAgent: z.string().default('Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/146.0.0.0 Safari/537.36'),
    language: z.string().default('zh-cn')
  }).prefault({}),
  accounts: z.array(AccountConfigSchema).default([] as never),
  login: z.object({
    prewarm: z.boolean().default(true),
    qrRefreshLimit: z.number().int().default(5),
    loginConcurrency: z.number().int().default(2),
    reloginLeadMinutes: z.number().int().default(45),
    silentRelogin: z.object({ enabled: z.boolean().default(true), maxAttempts: z.number().int().default(2) }).prefault({}),
    reloginCheckIntervalSeconds: z.number().int().default(60)
  }).prefault({}),
  keepalive: z.object({
    intervalSeconds: z.number().int().default(240),
    timeoutMs: z.number().int().default(15_000),
    failureThreshold: z.number().int().default(3)
  }).prefault({}),
  pool: z.object({
    perAccountConcurrency: z.number().int().default(2),
    ratePerSecond: z.object({ read: z.number().default(2), write: z.number().default(1) }).prefault({}),
    jitterMs: z.tuple([z.number(), z.number()]).default([100, 500]),
    retry: z.object({ maxAttempts: z.number().int().default(3), baseDelayMs: z.number().int().default(1000), maxDelayMs: z.number().int().default(60_000) }).prefault({}),
    accountCooldownMs: z.number().int().default(600_000)
  }).prefault({}),
  rules: z.object({
    protectionDays: z.number().int().default(15),
    releaseCooldownDays: z.number().int().default(3),
    capacityPerAccount: z.number().int().default(500),
    source: z.enum(['upstream', 'config']).default('upstream'),
    dedupRefreshHours: z.number().int().default(168),
    expiryWarnDays: z.number().int().default(3),
    requireDedupBeforeClaim: z.boolean().default(true)
  }).prefault({}),
  customs: z.object({
    cacheEnabled: z.boolean().default(true),
    resultTtlSeconds: z.number().int().default(86_400),
    dictTtlSeconds: z.number().int().default(604_800),
    staleWhileError: z.boolean().default(true),
    maxEntries: z.number().int().default(200_000),
    maxBytes: z.number().int().default(2 * 1024 * 1024 * 1024),
    retentionDays: z.number().int().default(90),
    updateLogCheckSeconds: z.number().int().default(300)
  }).prefault({}),
  events: z.object({
    retentionDays: z.number().int().default(30),
    webhook: z.object({ enabled: z.boolean().default(false), url: z.string().default(''), secret: z.string().default('') }).prefault({})
  }).prefault({}),
  logging: z.object({ level: z.enum(['debug', 'info', 'warn', 'error']).default('info'), redact: z.boolean().default(true) }).prefault({}),
  sync: z.object({ intervalSeconds: z.number().int().default(10), reconcileSeconds: z.number().int().default(300) }).prefault({}),
  tasks: z.object({ workers: z.number().int().default(2), retentionDays: z.number().int().default(90) }).prefault({})
});

export type Config = z.infer<typeof ConfigSchema>;
export type AccountConfig = z.infer<typeof AccountConfigSchema>;

export interface Paths {
  home: string;
  configFile: string;
  dbFile: string;
  logFile: string;
  profilesDir: string;
  backupDir: string;
  secretKeyFile: string;
}

export function resolveHome(): string {
  return process.env.FUMA_HOME ? resolve(process.env.FUMA_HOME) : resolve(homedir(), '.fuma-platform');
}

export function resolvePaths(home = resolveHome()): Paths {
  return {
    home,
    configFile: resolve(home, 'config.json'),
    dbFile: resolve(home, 'data', 'fuma.db'),
    logFile: resolve(home, 'logs', 'app.jsonl'),
    profilesDir: resolve(home, 'profiles'),
    backupDir: resolve(home, 'backups'),
    secretKeyFile: resolve(home, 'secret.key')
  };
}

/** 加载 .env（项目根目录），仅登录模块需要；不写入日志。 */
export function loadDotEnv(envFile = resolve(process.cwd(), '.env')): Record<string, string> {
  const out: Record<string, string> = {};
  if (!existsSync(envFile)) return out;
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const m = /^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/.exec(line);
    if (!m) continue;
    let value = m[2];
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) value = value.slice(1, -1);
    out[m[1]] = value;
    if (process.env[m[1]] === undefined) process.env[m[1]] = value;
  }
  return out;
}

function ensureDir(path: string): void {
  mkdirSync(path, { recursive: true, mode: 0o700 });
}

export function ensureHome(paths: Paths): void {
  ensureDir(paths.home);
  ensureDir(resolve(paths.home, 'data'));
  ensureDir(resolve(paths.home, 'logs'));
  ensureDir(paths.profilesDir);
  ensureDir(paths.backupDir);
}

export function defaultConfig(paths: Paths): Config {
  return ConfigSchema.parse({
    server: { apiToken: newSecret(24) },
    paths: {
      home: paths.home,
      dbFile: paths.dbFile,
      logFile: paths.logFile,
      profilesDir: paths.profilesDir,
      backupDir: paths.backupDir
    }
  });
}

export function loadConfig(opts: { home?: string; createIfMissing?: boolean } = {}): { config: Config; paths: Paths } {
  const paths = resolvePaths(opts.home);
  ensureHome(paths);
  if (!existsSync(paths.configFile)) {
    if (opts.createIfMissing === false) throw new Error(`配置文件不存在: ${paths.configFile}`);
    const config = defaultConfig(paths);
    writeConfig(paths, config);
    return { config, paths };
  }
  const raw = JSON.parse(readFileSync(paths.configFile, 'utf8')) as unknown;
  const parsed = ConfigSchema.parse(raw);
  // 兜底：确保 token 存在
  if (!parsed.server.apiToken) {
    parsed.server.apiToken = newSecret(24);
    writeConfig(paths, parsed);
  }
  return { config: parsed, paths };
}

export function writeConfig(paths: Paths, config: Config): void {
  writeFileSync(paths.configFile, JSON.stringify(config, null, 2) + '\n', { mode: 0o600 });
  try { chmodSync(paths.configFile, 0o600); } catch { /* ignore */ }
}

export function upsertAccount(config: Config, account: AccountConfig): Config {
  const idx = config.accounts.findIndex((a) => a.accountId === account.accountId);
  if (idx >= 0) config.accounts[idx] = account;
  else config.accounts.push(account);
  return config;
}

export function findAccount(config: Config, accountId: string): AccountConfig | undefined {
  return config.accounts.find((a) => a.accountId === accountId);
}
