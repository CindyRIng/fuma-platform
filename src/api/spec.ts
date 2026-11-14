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

function paramSchema(p: ParamSpec): Record<string, unknown> {
  const base: Record<string, unknown> = { description: p.description };
  if (p.type === 'json') return { ...base, type: 'object', additionalProperties: true };
  return { ...base, type: jsonType[p.type] };
}

function objectSchema(params: ParamSpec[], onlyBody = false): Record<string, unknown> {
  const props: Record<string, unknown> = {};
  const required: string[] = [];
  for (const p of params) {
    if (onlyBody && (p.in === 'arg' || p.in === 'option')) props[p.name] = paramSchema(p);
    else props[p.name] = paramSchema(p);
    if (p.required) required.push(p.name);
  }
  return { type: 'object', properties: props, ...(required.length ? { required } : {}), additionalProperties: false };
}

export function capabilityToOpenApi(c: Capability): Record<string, unknown> {
  const pathParams: Array<Record<string, unknown>> = [];
  const queryParams: Array<Record<string, unknown>> = [];
  const bodyParams: Array<Record<string, unknown>> = [];
  for (const m of c.http.path.matchAll(/\{([^}]+)\}/g)) {
    const name = m[1];
    pathParams.push({ name, in: 'path', required: true, schema: { type: 'string' } });
  }
  for (const p of c.params) {
    if (p.in === 'arg') continue;
    const inPath = c.http.path.includes(`{${p.name}}`);
    if (inPath) continue;
    if (c.http.method === 'GET') queryParams.push({ name: p.name, in: 'query', required: !!p.required, ...paramSchema(p) });
    else bodyParams.push({ name: p.name, ...paramSchema(p) });
  }
  const op: Record<string, unknown> = {
    operationId: c.id,
    summary: c.summary,
    description: c.description,
    tags: [c.category],
    parameters: [...pathParams, ...queryParams],
    responses: {
      '200': { description: '成功（统一 envelope）', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } },
      '4XX': { description: '业务错误（envelope.ok=false）', content: { 'application/json': { schema: { $ref: '#/components/schemas/Envelope' } } } }
    },
    'x-fuma': { capability: c.id, phase: c.phase, mutating: c.mutating, implemented: c.implemented, cli: `fuma ${c.noun} ${c.verb}`, mcp: c.mcp.tool }
  };
  if (bodyParams.length) {
    op.requestBody = {
      required: bodyParams.some((p) => (p.required as boolean)),
      content: {
        'application/json': {
          schema: {
            type: 'object',
            properties: Object.fromEntries(bodyParams.map((p) => [p.name as string, { description: p.description, ...(p.type === 'object' ? { type: 'object', additionalProperties: true } : { type: p.type }) }])),
            ...(bodyParams.some((p) => p.required) ? { required: bodyParams.filter((p) => p.required).map((p) => p.name) } : {})
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
  return {
    openapi: '3.1.0',
    info: {
      title: 'fuma-platform API',
      version: VERSION,
      description: `fumamx 本地封装平台 REST API。specVersion=${SPEC_VERSION}。统一 envelope：{ok,data,meta,error}。鉴权：Authorization: Bearer <apiToken>（/v1/health 与 /v1/docs 除外）。`
    },
    servers: [{ url: 'http://127.0.0.1:17890', description: '本机 REST' }],
    tags: [...new Set(CAPABILITIES.map((c) => c.category))].map((name) => ({ name })),
    paths,
    components: {
      schemas: {
        Envelope: {
          type: 'object',
          required: ['ok', 'data', 'meta', 'error'],
          properties: {
            ok: { type: 'boolean' },
            data: { nullable: true },
            meta: { type: 'object', properties: { requestId: { type: 'string' }, specVersion: { type: 'string' }, durationMs: { type: 'number' }, accountId: { type: 'string' } } },
            error: {
              nullable: true,
              type: 'object',
              properties: { code: { type: 'string' }, message: { type: 'string' }, retryable: { type: 'boolean' }, details: { type: 'object' }, retryAfterMs: { type: 'number' } }
            }
          }
        }
      },
      securitySchemes: { bearerAuth: { type: 'http', scheme: 'bearer' } }
    },
    security: [{ bearerAuth: [] }]
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
