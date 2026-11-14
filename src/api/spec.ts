import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { CAPABILITIES, type Capability, type ParamSpec } from './capabilities.js';
import { VERSION, SPEC_VERSION } from '../version.js';

const jsonType: Record<ParamSpec['type'], string> = {
  string: 'string',
  number: 'number',
  boolean: 'boolean',
  json: 'object'
};

const TAG_DESCRIPTIONS: Record<string, string> = {
  system: '系统与能力发现（健康检查、状态、版本、能力清单）',
  account: '账号登记与容量',
  session: '登录会话：扫码登录、二维码、心跳、登出（token 加密存储）',
  customer: '客户（客保库）：列表/详情/建档/编辑/删除',
  open_sea: '公海：列表、领取（强制先查后领）、释放、冷却',
  dedup: '查重：单次/历史/批量任务化',
  contact: '联系人：查询与新增',
  followup: '跟进：时间线与新增',
  customs: '海关数据：按公司查询 / 字典 / 本地缓存',
  sync: '同步与对账：outbox、reconcile、retry',
  event: '事件：轮询、归档清理',
  task: '任务：查询/取消/批量任务',
  cache: '缓存运维',
  meta: '元数据与字典'
};

function paramSchema(p: ParamSpec): Record<string, unknown> {
  const base: Record<string, unknown> = { description: p.description };
  if (p.default !== undefined) base.default = p.default;
  if (p.type === 'json') return { ...base, type: 'object', additionalProperties: true };
  return { ...base, type: jsonType[p.type] };
}

function envelopeResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } }
  };
}

function errorResponse(description: string): Record<string, unknown> {
  return {
    description,
    content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } }
  };
}

export function capabilityToOpenApi(c: Capability): Record<string, unknown> {
  const pathNames = new Set([...c.http.path.matchAll(/\{([^}]+)\}/g)].map((m) => m[1]));
  const pathParams = [...pathNames].map((name) => ({ name, in: 'path', required: true, schema: { type: 'string' }, description: `路径参数 ${name}` }));
  const queryParams: Array<Record<string, unknown>> = [];
  const bodyProps: Record<string, unknown> = {};
  const bodyRequired: string[] = [];
  for (const p of c.params) {
    if (pathNames.has(p.name)) continue;
    if (c.http.method === 'GET') {
      queryParams.push({ name: p.name, in: 'query', required: !!p.required, ...paramSchema(p) });
    } else {
      bodyProps[p.name] = paramSchema(p);
      if (p.required) bodyRequired.push(p.name);
    }
  }
  const description = [
    c.description,
    '',
    `CLI: \`fuma ${c.noun} ${c.verb}\`；MCP: \`${c.mcp.tool}\`。`,
    '',
    '统一响应 envelope：`{ok,data,meta,error}`；失败时 `ok=false` 且 `error.code` 为业务错误码。'
  ].join('\n');
  const op: Record<string, unknown> = {
    operationId: c.id,
    summary: c.title,
    description,
    tags: [c.category],
    parameters: [...pathParams, ...queryParams],
    responses: {
      '200': envelopeResponse('成功（envelope.ok=true）'),
      '400': errorResponse('参数错误（invalid_argument）'),
      '401': errorResponse('未鉴权或 token 无效（unauthorized）'),
      '404': errorResponse('资源不存在（not_found）'),
      '409': errorResponse('状态冲突（conflict）'),
      '500': errorResponse('服务内部错误（internal_error）')
    },
    deprecated: !c.implemented,
    'x-fuma-capability': c.id,
    'x-fuma-phase': c.phase,
    'x-fuma-mutating': c.mutating,
    'x-fuma-implemented': c.implemented,
    'x-fuma-cli': `fuma ${c.noun} ${c.verb}`,
    'x-fuma-mcp': c.mcp.tool,
    'x-fuma-example': c.example
  };
  if (c.http.path === '/v1/health') op.security = [];
  if (c.http.method !== 'GET' && Object.keys(bodyProps).length) {
    op.requestBody = {
      required: bodyRequired.length > 0,
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: bodyProps,
            ...(bodyRequired.length ? { required: bodyRequired } : {}),
            additionalProperties: false
          }
        }
      }
    };
  }
  return op;
}

export function buildOpenApi(): Record<string, unknown> {
  const paths: Record<string, Record<string, unknown>> = {};
  for (const c of CAPABILITIES) {
    const method = c.http.method.toLowerCase();
    paths[c.http.path] = paths[c.http.path] ?? {};
    paths[c.http.path][method] = capabilityToOpenApi(c);
  }
  const categories = [...new Set(CAPABILITIES.map((c) => c.category))];
  return {
    openapi: '3.0.3',
    info: {
      title: 'fuma-platform API',
      version: VERSION,
      summary: '孚盟本地封装平台 REST API（标准 OpenAPI 3.0）',
      description: [
        'fuma-platform 是孚盟（fumamx.com）本地封装平台的 REST API。',
        '',
        '**统一响应 envelope**：`{ ok, data, meta, error }`；成功 `ok=true`，失败 `ok=false` 且 `error.code` 为业务错误码。',
        '',
        '**鉴权**：`Authorization: Bearer <apiToken>`（apiToken 见 `~/.fuma-platform/config.json`）；`/v1/health`、`/v1/docs`、`/v1/openapi.json` 等公开。',
        '',
        '**能力与入口**：44 项能力同时映射 CLI / REST / MCP；扩展字段 `x-fuma-*` 给出 CLI/MCP 映射与实现阶段。',
        '',
        `specVersion: ${SPEC_VERSION}；Swagger UI: /v1/docs；OpenAPI JSON: /v1/openapi.json`
      ].join('\n'),
      contact: { name: 'fuma-platform', url: 'https://github.com/CindyRIng/fuma-platform' },
      license: { name: 'MIT', url: 'https://github.com/CindyRIng/fuma-platform/blob/main/LICENSE' }
    },
    servers: [
      { url: '/', description: '当前服务（相对路径）' },
      { url: 'http://127.0.0.1:17890', description: '本机默认 REST 地址' }
    ],
    tags: categories.map((name) => ({ name, description: TAG_DESCRIPTIONS[name] ?? name })),
    paths,
    externalDocs: { description: '项目文档', url: 'https://github.com/CindyRIng/fuma-platform/blob/main/docs/README.md' },
    components: {
      securitySchemes: {
        bearerAuth: { type: 'http', scheme: 'bearer', bearerFormat: 'apiToken', description: 'REST apiToken（Authorization: Bearer <token>）' }
      },
      schemas: {
        Meta: {
          type: 'object',
          properties: {
            requestId: { type: 'string' },
            specVersion: { type: 'string' },
            durationMs: { type: 'number' },
            accountId: { type: 'string', nullable: true }
          }
        },
        Error: {
          type: 'object',
          nullable: true,
          properties: {
            code: { type: 'string', description: '业务错误码，如 invalid_argument / unauthorized / not_found / conflict / upstream_error' },
            message: { type: 'string' },
            retryable: { type: 'boolean' },
            details: { type: 'object', nullable: true, additionalProperties: true },
            retryAfterMs: { type: 'number', nullable: true }
          }
        },
        Envelope: {
          type: 'object',
          description: '统一响应 envelope',
          required: ['ok', 'data', 'meta', 'error'],
          properties: {
            ok: { type: 'boolean' },
            data: { nullable: true, description: '业务数据（各能力不同；失败时为 null）' },
            meta: { $ref: '#/components/schemas/Meta' },
            error: { $ref: '#/components/schemas/Error' }
          }
        }
      }
    },
    security: [{ bearerAuth: [] }],
    'x-fuma-spec-version': SPEC_VERSION
  };
}

export interface CliSpecEntry {
  command: string;
  noun: string;
  verb: string;
  title: string;
  summary: string;
  description: string;
  args: Array<{ name: string; type: string; required: boolean; description: string }>;
  options: Array<{ flags: string; type: string; required: boolean; description: string; default?: unknown }>;
  example: string;
  phase: string;
  implemented: boolean;
}

export function buildCliSpec(): CliSpecEntry[] {
  return CAPABILITIES.map((c) => ({
    command: `fuma ${c.noun} ${c.verb}`,
    noun: c.noun,
    verb: c.verb,
    title: c.title,
    summary: c.summary,
    description: c.description,
    args: c.params.filter((p) => p.in === 'arg').map((p) => ({ name: p.name, type: p.type, required: !!p.required, description: p.description })),
    options: c.params.filter((p) => p.in === 'option').map((p) => ({ flags: p.flags ?? `--${p.name}`, type: p.type, required: !!p.required, description: p.description, default: p.default })),
    example: c.example,
    phase: c.phase,
    implemented: c.implemented
  }));
}

export interface McpSpecEntry {
  name: string;
  title: string;
  description: string;
  inputSchema: Record<string, unknown>;
  phase: string;
  implemented: boolean;
}

export function buildMcpSpec(): McpSpecEntry[] {
  return CAPABILITIES.map((c) => {
    const properties: Record<string, unknown> = {};
    const required: string[] = [];
    for (const p of c.params) {
      properties[p.name] = p.type === 'json'
        ? { type: 'object', additionalProperties: true, description: p.description }
        : { type: p.type, description: p.description };
      if (p.required) required.push(p.name);
    }
    return {
      name: c.mcp.tool,
      title: c.title,
      description: `${c.description}\n\n对应 CLI: fuma ${c.noun} ${c.verb}；对应 REST: ${c.http.method} ${c.http.path}。` ,
      inputSchema: { type: 'object', properties, ...(required.length ? { required } : {}), additionalProperties: false },
      phase: c.phase,
      implemented: c.implemented
    };
  });
}

export function writeSpecFiles(outDir = resolve(process.cwd(), 'spec')): { openapi: string; cli: string; mcp: string } {
  mkdirSync(outDir, { recursive: true });
  const openapi = resolve(outDir, 'openapi.json');
  const cli = resolve(outDir, 'cli-commands.json');
  const mcp = resolve(outDir, 'mcp-tools.json');
  writeFileSync(openapi, JSON.stringify(buildOpenApi(), null, 2) + '\n');
  writeFileSync(cli, JSON.stringify(buildCliSpec(), null, 2) + '\n');
  writeFileSync(mcp, JSON.stringify(buildMcpSpec(), null, 2) + '\n');
  return { openapi, cli, mcp };
}
