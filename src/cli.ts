import { Command } from 'commander';
import { existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { homedir } from 'node:os';
import { join, resolve } from 'node:path';
import { AppError, toAppError } from './core/errors.js';
import { capabilitiesByNoun, CAPABILITIES, getCapability, type Capability, type ParamSpec } from './api/capabilities.js';
import { dispatch } from './api/dispatch.js';
import { errorEnvelope, okEnvelope } from './api/envelope.js';
import { renderAllCapabilitiesMarkdown, renderCapabilityMarkdown, renderCliHelp, tableFormat } from './api/help.js';
import { writeSpecFiles } from './api/spec.js';
import { startMcpServer } from './api/mcp.js';
import { startRestServer } from './api/rest.js';
import { newRequestId } from './core/ids.js';
import { SCHEMA_VERSION } from './core/store.js';
import { getRuntime, type Runtime } from './services/runtime.js';
import { listAccounts } from './services/accounts.js';
import { Scheduler } from './services/scheduler.js';
import { SPEC_VERSION, VERSION } from './version.js';

interface Globals {
  home?: string;
  format?: string;
  quiet?: boolean;
  debug?: boolean;
  json?: boolean;
}

function coerceCli(p: ParamSpec, raw: unknown): unknown {
  if (raw === undefined || raw === null || raw === '') return undefined;
  if (p.type === 'number') {
    const n = Number(raw);
    if (!Number.isFinite(n)) throw new AppError('invalid_argument', `参数 ${p.name} 需要数字`);
    return n;
  }
  if (p.type === 'boolean') {
    if (typeof raw === 'boolean') return raw;
    const s = String(raw).toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    return Boolean(raw);
  }
  if (p.type === 'json') {
    if (typeof raw === 'object') return raw;
    try { return JSON.parse(String(raw)); } catch { throw new AppError('invalid_argument', `参数 ${p.name} 需要合法 JSON`); }
  }
  return String(raw);
}

function optionKeyOf(p: ParamSpec): string {
  const m = /--([a-zA-Z0-9-]+)/.exec(p.flags ?? '');
  if (!m) return p.name;
  return m[1].replace(/-([a-z])/g, (_: string, ch: string) => ch.toUpperCase());
}

function exitCodeOf(code: string): number {
  if (code === 'invalid_argument' || code === 'unauthorized') return 2;
  if (code === 'not_implemented' || code === 'not_found' || code === 'conflict' || code === 'capacity_exceeded'
    || code === 'cooldown_active' || code === 'duplicate_customer' || code === 'permission_denied' || code === 'task_cancelled') return 3;
  if (code === 'upstream_error' || code === 'session_expired' || code === 'account_busy' || code === 'rate_limited' || code === 'timeout') return 4;
  return 5;
}

function outputEnvelope(env: unknown, opts: { quiet?: boolean; format?: string; json?: boolean }): void {
  if (opts.json) {
    console.log(JSON.stringify(env, null, 2));
    return;
  }
  const e = env as { ok: boolean; data: unknown };
  if (opts.quiet) {
    console.log(typeof e.data === 'string' ? e.data : JSON.stringify(e.data, null, 2));
    return;
  }
  if (opts.format === 'table' && e.ok && Array.isArray(e.data)) {
    console.log(tableFormat(e.data as Array<Record<string, unknown>>));
    return;
  }
  console.log(JSON.stringify(env, null, 2));
}

function addCapabilityCommand(parent: Command, cap: Capability, program: Command): void {
  const cmd = parent.command(cap.verb).description(`${cap.title} — ${cap.summary}`);
  const argParams = cap.params.filter((p) => p.in === 'arg');
  for (const p of argParams) cmd.argument(p.required ? `<${p.name}>` : `[${p.name}]`, p.description);
  for (const p of cap.params.filter((p) => p.in === 'option')) {
    const flags = p.flags ?? `--${p.name}`;
    if (p.type === 'boolean') {
      if (p.default === true) cmd.option(`--no-${p.name.replace(/^--/, '')}`, p.description);
      else cmd.option(flags, p.description);
    } else if (p.default !== undefined) {
      cmd.option(flags, p.description, p.default as never);
    } else {
      cmd.option(flags, p.description);
    }
  }
  cmd.option('--json', '强制 JSON envelope 输出');
  cmd.action(async (...args: unknown[]) => {
    const command = args[args.length - 1] as Command;
    const opts = (args[args.length - 2] ?? {}) as Record<string, unknown>;
    const globals = program.opts<Globals>();
    const input: Record<string, unknown> = {};
    let i = 0;
    for (const p of cap.params) {
      if (p.in === 'arg') {
        const raw = args[i++];
        const v = coerceCli(p, raw);
        if (v !== undefined) input[p.name] = v;
        else if (p.default !== undefined) input[p.name] = p.default;
      } else {
        const key = p.name;
        const raw = opts[optionKeyOf(p)] ?? opts[key];
        const v = coerceCli(p, raw);
        if (v !== undefined) input[p.name] = v;
        else if (p.default !== undefined) input[p.name] = p.default;
      }
      if (p.required && (input[p.name] === undefined || input[p.name] === '')) {
        const msg = `缺少必填参数 ${p.in === 'arg' ? p.name : (p.flags ?? `--${p.name}`)}`;
        outputEnvelope(errorEnvelope(new AppError('invalid_argument', msg), { requestId: newRequestId(), specVersion: SPEC_VERSION, durationMs: 0 }), globals);
        process.exitCode = 2;
        return;
      }
    }
    const started = Date.now();
    const requestId = newRequestId();
    let rt: Runtime | null = null;
    try {
      rt = getRuntime({ home: globals.home, loggerLevel: globals.debug ? 'debug' : undefined, silentConsole: true });
      if (cap.id === 'session.login' && !(opts as { json?: boolean }).json) {
        await interactiveLogin(rt, String(input.accountId), program);
        return;
      }
      const data = await dispatch(rt, cap.id, input, { requestId, actor: 'cli' });
      outputEnvelope(okEnvelope(data, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started }), globals);
    } catch (err) {
      const app = toAppError(err);
      outputEnvelope(errorEnvelope(app, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started }), globals);
      process.exitCode = exitCodeOf(app.code);
    } finally {
      void command;
    }
  });
}

interface ServiceTargetOpts { url?: string; token?: string; timeout?: string }

function serviceTarget(globals: Globals, opts: ServiceTargetOpts): { url: string; token: string; timeoutMs: number } {
  let url = opts.url;
  let token = opts.token;
  if (!url || !token) {
    const home = globals.home ?? process.env.FUMA_HOME ?? join(homedir(), '.fuma-platform');
    const cfg = JSON.parse(readFileSync(join(home, 'config.json'), 'utf8')) as { server?: { restHost?: string; restPort?: number; apiToken?: string } };
    const host = !cfg.server?.restHost || cfg.server.restHost === '0.0.0.0' ? '127.0.0.1' : cfg.server.restHost;
    url = url ?? `http://${host}:${cfg.server?.restPort ?? 17890}`;
    token = token ?? cfg.server?.apiToken ?? '';
  }
  return { url: url.replace(/\/$/, ''), token, timeoutMs: Math.max(500, Number(opts.timeout ?? 5000)) };
}

async function fetchDaemon(globals: Globals, opts: ServiceTargetOpts, path: string): Promise<void> {
  const target = serviceTarget(globals, opts);
  const res = await fetch(target.url + path, {
    headers: { authorization: `Bearer ${target.token}` },
    signal: AbortSignal.timeout(target.timeoutMs)
  });
  const text = await res.text();
  let body: unknown;
  try { body = JSON.parse(text); } catch { body = { ok: false, data: null, error: { code: 'bad_response', message: text.slice(0, 300) } }; }
  const env = body as { ok?: boolean; data?: unknown };
  if (globals.quiet && env.data !== undefined) console.log(JSON.stringify(env.data, null, 2));
  else console.log(JSON.stringify(body, null, 2));
  if (!res.ok || env.ok === false) process.exitCode = 2;
}

function addSpecialCommands(program: Command): void {
  program.command('version')
    .description('显示版本信息')
    .option('--json', 'JSON 输出')
    .action((opts: { json?: boolean }) => {
      const data = { version: VERSION, specVersion: SPEC_VERSION, node: process.version, schemaVersion: SCHEMA_VERSION };
      if (opts.json) console.log(JSON.stringify(data, null, 2));
      else console.log(`${data.version} (spec ${data.specVersion}, node ${data.node}, schema v${data.schemaVersion})`);
    });

  program.command('serve')
    .description('启动 REST 服务（默认 127.0.0.1:17890）')
    .option('--host <host>', '监听地址')
    .option('--port <port>', '监听端口')
    .action(async (opts: { host?: string; port?: string }) => {
      const globals = program.opts<Globals>();
      const rt = getRuntime({ home: globals.home, loggerLevel: globals.debug ? 'debug' : undefined });
      const { server, url } = await startRestServer(rt, {
        host: opts.host,
        port: opts.port ? Number(opts.port) : undefined,
        logger: rt.logger
      });
      const scheduler = new Scheduler(rt);
      scheduler.start();
      console.log(JSON.stringify({ ok: true, data: { url, docs: `${url}/v1/docs`, openapi: `${url}/v1/openapi.json`, scheduler: true } }, null, 2));
      const shutdown = () => { scheduler.stop(); server.close(() => { rt.close(); process.exit(0); }); };
      process.on('SIGINT', shutdown);
      process.on('SIGTERM', shutdown);
    });

  const service = program.command('service').description('服务端运维：查询正在运行的 REST 服务（daemon）');
  service.command('status')
    .description('查询运行中服务状态（等同 REST GET /v1/status；pid/uptime 为 daemon 进程）')
    .option('--url <url>', '服务地址（默认取 config）')
    .option('--token <token>', 'REST apiToken（默认取 config）')
    .option('--timeout <ms>', '超时毫秒', '5000')
    .action(async (opts: ServiceTargetOpts) => {
      const globals = program.opts<Globals>();
      await fetchDaemon(globals, opts, '/v1/status');
    });
  service.command('health')
    .description('查询运行中服务健康（等同 REST GET /v1/health）')
    .option('--url <url>', '服务地址（默认取 config）')
    .option('--token <token>', 'REST apiToken（默认取 config）')
    .option('--timeout <ms>', '超时毫秒', '5000')
    .action(async (opts: ServiceTargetOpts) => {
      const globals = program.opts<Globals>();
      await fetchDaemon(globals, opts, '/v1/health');
    });

  program.command('mcp')
    .description('以 stdio 启动 MCP server')
    .action(async () => {
      const globals = program.opts<Globals>();
      // MCP stdio 的 stdout 只能输出 JSON-RPC 消息，日志必须禁用控制台输出
      const rt = getRuntime({ home: globals.home, loggerLevel: globals.debug ? 'debug' : undefined, silentConsole: true });
      await startMcpServer(rt);
    });

  program.command('spec')
    .description('生成 OpenAPI / CLI / MCP spec 文件（默认 ./spec）')
    .option('--out <dir>', '输出目录', 'spec')
    .action((opts: { out?: string }) => {
      const out = writeSpecFiles(resolve(process.cwd(), opts.out ?? 'spec'));
      console.log(JSON.stringify({ ok: true, data: out }, null, 2));
    });

  program.command('docs')
    .description('打印能力文档（全部或指定能力 id）')
    .argument('[capabilityId]', '能力 id，如 account.list')
    .action((capabilityId?: string) => {
      if (capabilityId) {
        const cap = getCapability(capabilityId);
        if (!cap) { console.error(`未知能力: ${capabilityId}`); process.exitCode = 2; return; }
        console.log(renderCapabilityMarkdown(cap));
      } else {
        console.log(renderAllCapabilitiesMarkdown());
      }
    });

  program.command('doctor')
    .description('环境体检：配置/数据库/sqlite flag/权限')
    .option('--json', 'JSON 输出')
    .action((opts: { json?: boolean }) => {
      const globals = program.opts<Globals>();
      const checks: Array<{ name: string; ok: boolean; detail?: string }> = [];
      checks.push({ name: 'node>=22.5', ok: Number(process.versions.node.split('.')[0]) >= 22, detail: process.version });
      checks.push({ name: 'experimental-sqlite flag', ok: process.execArgv.includes('--experimental-sqlite') || process.env.NODE_OPTIONS?.includes('--experimental-sqlite') === true, detail: process.execArgv.join(' ') });
      try {
        const rt = getRuntime({ home: globals.home, createIfMissing: true });
        checks.push({ name: 'home/config', ok: existsSync(rt.paths.configFile), detail: rt.paths.home });
        checks.push({ name: 'secret.key(600)', ok: existsSync(rt.paths.secretKeyFile) && (statSync(rt.paths.secretKeyFile).mode & 0o777) <= 0o600, detail: rt.paths.secretKeyFile });
        checks.push({ name: 'db open', ok: true, detail: rt.paths.dbFile });
        checks.push({ name: 'schema', ok: true, detail: `v${SCHEMA_VERSION}` });
        checks.push({ name: 'accounts', ok: true, detail: String(listAccounts(rt).length) });
        rt.close();
      } catch (err) {
        checks.push({ name: 'runtime', ok: false, detail: toAppError(err).message });
      }
      const report = { ok: checks.every((c) => c.ok), data: { checks } };
      if (opts.json) console.log(JSON.stringify(report, null, 2));
      else {
        for (const c of checks) console.log(`${c.ok ? '✓' : '✗'} ${c.name}${c.detail ? ` — ${c.detail}` : ''}`);
      }
      if (!report.ok) process.exitCode = 5;
    });

  program.command('backup')
    .description('备份 SQLite 数据库（VACUUM INTO）')
    .option('--dest <file>', '目标文件路径')
    .action((opts: { dest?: string }) => {
      const globals = program.opts<Globals>();
      const rt = getRuntime({ home: globals.home });
      const dest = resolve(opts.dest ?? `${rt.paths.backupDir}/fuma-${new Date().toISOString().slice(0, 10)}.db`);
      mkdirSync(resolve(dest, '..'), { recursive: true });
      rt.store.backup(dest);
      rt.close();
      console.log(JSON.stringify({ ok: true, data: { dest } }, null, 2));
    });
}

async function interactiveLogin(rt: Runtime, accountId: string, program: Command): Promise<void> {
  const requestId = newRequestId();
  const started = Date.now();
  const globals = program.opts<Globals>();
  try {
    const initial = await dispatch(rt, 'session.login', { accountId }, { requestId, actor: 'cli' });
    outputEnvelope(okEnvelope(initial, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started, accountId }), globals);
    let lastRefresh = -1;
    const deadline = Date.now() + 10 * 60 * 1000;
    while (Date.now() < deadline) {
      const view = rt.sessions.getView(accountId);
      if (view.state === 'qr_ready' && view.qr && view.qr.refreshCount !== lastRefresh) {
        lastRefresh = view.qr.refreshCount;
        const qr = await rt.sessions.getQr(accountId).catch(() => null);
        if (qr?.ascii) console.error(qr.ascii);
        console.error(`[QR] 第 ${lastRefresh} 次刷新，过期时间 ${view.qr.expiresAt}；也可 'fuma session qr ' + accountId + ' --json' 获取 base64/png`);
      }
      if (['online', 'failed', 'cancelled', 'expired'].includes(view.state)) {
        outputEnvelope(okEnvelope(view, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started, accountId }), globals);
        process.exitCode = view.state === 'online' ? 0 : 4;
        return;
      }
      await new Promise((r) => setTimeout(r, 1500));
    }
    outputEnvelope(errorEnvelope(new AppError('timeout', '登录等待超时（10 分钟）'), { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started, accountId }), globals);
    process.exitCode = 4;
  } catch (err) {
    const app = toAppError(err);
    outputEnvelope(errorEnvelope(app, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started, accountId }), globals);
    process.exitCode = exitCodeOf(app.code);
  }
}

export function buildProgram(): Command {
  const program = new Command();
  program
    .name('fuma')
    .description(`fuma-platform：孚盟本地封装平台（多账号会话池 + 请求池 + 本地缓存 + 事件）\n\n版本 ${VERSION}｜spec ${SPEC_VERSION}`)
    .version(`${VERSION} (spec ${SPEC_VERSION})`, '-v, --version', '显示版本')
    .option('--home <dir>', '数据目录（默认 ~/.fuma-platform 或 FUMA_HOME）')
    .option('--format <format>', '输出格式：json|table', 'json')
    .option('--quiet', '仅输出 data 部分')
    .option('--debug', '调试日志')
    .addHelpText('after', `\n运行 'fuma docs' 查看全部能力文档；'fuma <noun> <verb> --help' 查看单命令帮助。`);

  const nounDescriptions: Record<string, string> = {
    system: '系统：健康检查、状态、版本、能力清单',
    account: '账号：登记/更新/容量查询（不替调用方选账号）',
    session: '会话：登录、二维码、状态、登出（P3）',
    customer: '客户：列表/详情/建档/编辑/删除（本地优先）',
    'open-sea': '公海：列表、领取（强制查重）、释放',
    dedup: '查重：单条/批量/历史',
    contact: '联系人：列表/新建/编辑',
    followup: '跟进：列表/新建',
    customs: '海关数据：按公司查询（强制本地缓存）',
    task: '任务：状态/列表/取消',
    event: '事件：轮询/订阅（P5）',
    sync: '同步：状态/对账/重试（P5）'
  };

  for (const [noun, caps] of capabilitiesByNoun()) {
    const group = program.command(noun).description(nounDescriptions[noun] ?? noun);
    for (const cap of caps) addCapabilityCommand(group, cap, program);
  }

  addSpecialCommands(program);
  program.addHelpText('after', `\n能力总数 ${CAPABILITIES.length}。`);
  return program;
}

export async function runCli(argv: string[]): Promise<void> {
  const program = buildProgram();
  if (argv.length <= 2) {
    console.log(renderCliHelp());
    return;
  }
  await program.parseAsync(argv);
}
