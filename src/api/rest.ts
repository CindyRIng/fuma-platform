import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { CAPABILITIES, type Capability, type ParamSpec } from './capabilities.js';
import { dispatch } from './dispatch.js';
import { errorEnvelope, httpStatusOf, okEnvelope } from './envelope.js';
import { renderRestDocsHtml } from './help.js';
import { buildCliSpec, buildMcpSpec, buildOpenApi } from './spec.js';
import { newRequestId } from '../core/ids.js';
import { AppError, toAppError } from '../core/errors.js';
import { SPEC_VERSION, VERSION } from '../version.js';
import type { Runtime } from '../services/runtime.js';

const requireFromHere = createRequire(import.meta.url);
let swaggerDir: string | null = null;
const swaggerCache = new Map<string, Buffer>();

function swaggerAsset(name: string): Buffer | null {
  const cached = swaggerCache.get(name);
  if (cached) return cached;
  try {
    if (!swaggerDir) swaggerDir = dirname(requireFromHere.resolve('swagger-ui-dist/package.json'));
    const buf = readFileSync(join(swaggerDir, name));
    swaggerCache.set(name, buf);
    return buf;
  } catch {
    return null;
  }
}

const SWAGGER_ASSETS: Record<string, { file: string; mime: string }> = {
  'swagger-ui.css': { file: 'swagger-ui.css', mime: 'text/css; charset=utf-8' },
  'swagger-ui-bundle.js': { file: 'swagger-ui-bundle.js', mime: 'application/javascript; charset=utf-8' },
  'swagger-ui-standalone-preset.js': { file: 'swagger-ui-standalone-preset.js', mime: 'application/javascript; charset=utf-8' }
};

function renderSwaggerHtml(): string {
  return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>fuma-platform API · Swagger UI</title>
  <link rel="stylesheet" href="/v1/docs/swagger-ui.css">
  <style>body{margin:0;background:#fafafa} .topbar{display:none} .swagger-ui .info{margin:24px 0}</style>
</head>
<body>
  <div id="swagger-ui"></div>
  <script src="/v1/docs/swagger-ui-bundle.js"></script>
  <script src="/v1/docs/swagger-ui-standalone-preset.js"></script>
  <script>
    window.onload = function () {
      window.ui = SwaggerUIBundle({
        url: '/v1/openapi.json',
        dom_id: '#swagger-ui',
        deepLinking: true,
        persistAuthorization: true,
        displayRequestDuration: true,
        filter: true,
        tryItOutEnabled: true,
        presets: [SwaggerUIBundle.presets.apis, SwaggerUIStandalonePreset],
        layout: 'StandaloneLayout'
      });
    };
  </script>
</body>
</html>`;
}

interface Route {
  capability: Capability;
  method: string;
  segments: string[];
}

const PUBLIC_PATHS = new Set(['/v1/health', '/v1/docs', '/v1/docs/plain', '/v1/openapi.json', '/v1/spec/cli.json', '/v1/spec/mcp.json', '/']);

function tokenMatches(provided: string | undefined, expected: string): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

function buildRoutes(): Route[] {
  return CAPABILITIES.map((c) => ({ capability: c, method: c.http.method, segments: c.http.path.split('/').filter(Boolean) }));
}

function matchRoute(routes: Route[], method: string, pathSegs: string[]): { route: Route; params: Record<string, string> } | null {
  for (const r of routes) {
    if (r.method !== method || r.segments.length !== pathSegs.length) continue;
    const params: Record<string, string> = {};
    let ok = true;
    for (let i = 0; i < r.segments.length; i++) {
      const seg = r.segments[i];
      const m = /^\{([^}]+)\}$/.exec(seg);
      if (m) params[m[1]] = decodeURIComponent(pathSegs[i]);
      else if (seg !== pathSegs[i]) { ok = false; break; }
    }
    if (ok) return { route: r, params };
  }
  return null;
}

function coerce(p: ParamSpec, value: unknown): unknown {
  if (value === undefined || value === null) return undefined;
  if (p.type === 'number') {
    const n = typeof value === 'number' ? value : Number(value);
    if (!Number.isFinite(n)) throw new AppError('invalid_argument', `参数 ${p.name} 需要数字`);
    return n;
  }
  if (p.type === 'boolean') {
    if (typeof value === 'boolean') return value;
    const s = String(value).toLowerCase();
    if (['true', '1', 'yes'].includes(s)) return true;
    if (['false', '0', 'no'].includes(s)) return false;
    throw new AppError('invalid_argument', `参数 ${p.name} 需要布尔值`);
  }
  if (p.type === 'json') {
    if (typeof value === 'object') return value;
    try { return JSON.parse(String(value)); } catch { throw new AppError('invalid_argument', `参数 ${p.name} 需要合法 JSON`); }
  }
  return String(value);
}

async function readBody(req: IncomingMessage, limit = 2 * 1024 * 1024): Promise<unknown> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buf.length;
    if (size > limit) throw new AppError('invalid_argument', '请求体过大');
    chunks.push(buf);
  }
  if (!chunks.length) return {};
  const text = Buffer.concat(chunks).toString('utf8').trim();
  if (!text) return {};
  try { return JSON.parse(text); } catch { throw new AppError('invalid_argument', '请求体需为合法 JSON'); }
}

function sendJson(res: ServerResponse, status: number, body: unknown): void {
  const text = JSON.stringify(body);
  res.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

function sendText(res: ServerResponse, status: number, contentType: string, text: string): void {
  res.writeHead(status, { 'content-type': contentType, 'content-length': Buffer.byteLength(text) });
  res.end(text);
}

export interface RestOptions {
  host?: string;
  port?: number;
  logger?: Runtime['logger'];
}

export function createRestServer(rt: Runtime, opts: RestOptions = {}): Server {
  const routes = buildRoutes();
  const host = opts.host ?? rt.config.server.restHost;
  const apiToken = rt.config.server.apiToken;

  return createServer(async (req: IncomingMessage, res: ServerResponse) => {
    const requestId = newRequestId();
    const started = Date.now();
    const url = new URL(req.url ?? '/', `http://${req.headers.host ?? '127.0.0.1'}`);
    const pathname = url.pathname;
    try {
      // 特殊路由
      if (pathname === '/' || pathname === '/v1/docs') {
        sendText(res, 200, 'text/html; charset=utf-8', renderSwaggerHtml());
        return;
      }
      if (pathname === '/v1/docs/plain') {
        sendText(res, 200, 'text/html; charset=utf-8', renderRestDocsHtml(`http://${req.headers.host ?? `${host}:${opts.port ?? rt.config.server.restPort}`}`));
        return;
      }
      if (pathname.startsWith('/v1/docs/')) {
        const asset = SWAGGER_ASSETS[pathname.slice('/v1/docs/'.length)];
        const buf = asset ? swaggerAsset(asset.file) : null;
        if (asset && buf) {
          res.writeHead(200, { 'content-type': asset.mime, 'content-length': buf.length, 'cache-control': 'public, max-age=86400' });
          res.end(buf);
          return;
        }
        sendText(res, 404, 'text/plain; charset=utf-8', 'not found');
        return;
      }
      if (pathname === '/v1/openapi.json') { sendJson(res, 200, buildOpenApi()); return; }
      if (pathname === '/v1/spec/cli.json') { sendJson(res, 200, buildCliSpec()); return; }
      if (pathname === '/v1/spec/mcp.json') { sendJson(res, 200, buildMcpSpec()); return; }
      if (pathname === '/v1/health') {
        const data = await dispatch(rt, 'system.health', {}, { requestId, actor: 'rest' });
        sendJson(res, 200, okEnvelope(data, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started }));
        return;
      }

      // 鉴权（除 public）
      const authorization = String(req.headers.authorization ?? '');
      const bearer = authorization.startsWith('Bearer ') ? authorization.slice(7) : undefined;
      if (!PUBLIC_PATHS.has(pathname) && !tokenMatches(bearer, apiToken)) {
        throw new AppError('unauthorized', '无效或缺失 API Token');
      }

      const pathSegs = pathname.split('/').filter(Boolean);
      const matched = matchRoute(routes, req.method ?? 'GET', pathSegs);
      if (!matched) throw new AppError('not_found', `未知路由: ${req.method} ${pathname}`);

      const cap = matched.route.capability;
      const query: Record<string, unknown> = {};
      for (const [k, v] of url.searchParams.entries()) query[k] = v;
      let body: Record<string, unknown> = {};
      if (req.method !== 'GET' && req.method !== 'HEAD') {
        const parsed = await readBody(req);
        if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) body = parsed as Record<string, unknown>;
      }
      const input: Record<string, unknown> = {};
      for (const p of cap.params) {
        let raw: unknown;
        if (p.in === 'arg') raw = matched.params[p.name] ?? query[p.name] ?? body[p.name];
        else if (p.name in body) raw = body[p.name];
        else if (p.name in query) raw = query[p.name];
        else raw = undefined;
        if ((raw === undefined || raw === '') && p.default !== undefined) {
          input[p.name] = p.default;
        } else if (raw !== undefined) {
          input[p.name] = coerce(p, raw);
        }
        if (p.required && (input[p.name] === undefined || input[p.name] === '')) {
          throw new AppError('invalid_argument', `缺少必填参数 ${p.name}`);
        }
      }
      const data = await dispatch(rt, cap.id, input, { requestId, actor: 'rest', apiToken: bearer });
      sendJson(res, 200, okEnvelope(data, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started }));
    } catch (err) {
      const app = toAppError(err);
      opts.logger?.warn('rest request failed', { requestId, method: req.method, path: pathname, code: app.code });
      sendJson(res, httpStatusOf(app), errorEnvelope(app, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started }));
    }
  });
}

export function startRestServer(rt: Runtime, opts: RestOptions = {}): Promise<{ server: Server; url: string }> {
  const server = createRestServer(rt, opts);
  const host = opts.host ?? rt.config.server.restHost;
  const port = opts.port ?? rt.config.server.restPort;
  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, () => {
      const address = server.address();
      const actualPort = address && typeof address === 'object' ? address.port : port;
      rt.logger.info('REST server started', { host, port: actualPort, version: VERSION });
      resolve({ server, url: `http://${host}:${actualPort}` });
    });
  });
}
