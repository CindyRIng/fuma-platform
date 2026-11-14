import { describe, expect, it } from 'vitest';
import { mkdtempSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { buildCliSpec, buildMcpSpec, buildOpenApi, writeSpecFiles } from '../../src/api/spec.js';
import { CAPABILITIES } from '../../src/api/capabilities.js';

describe('spec', () => {
  it('OpenAPI 包含所有能力路径且方法正确', () => {
    const api = buildOpenApi() as { openapi: string; paths: Record<string, Record<string, unknown>> };
    expect(api.openapi).toBe('3.0.3');
    expect((api as unknown as { info?: { license?: { name?: string } } }).info?.license?.name).toBe('MIT');
    const ops = Object.values(api.paths).flatMap((p) => Object.values(p as Record<string, { operationId?: string }>));
    const ids = ops.map((o) => o.operationId);
    expect(new Set(ids).size).toBe(ids.length);
    const accountCreate = (api.paths['/v1/accounts']?.post ?? {}) as { requestBody?: { content?: { 'application/json'?: { schema?: { properties?: Record<string, unknown>; required?: string[] } } } } };
    expect(accountCreate.requestBody?.content?.['application/json']?.schema?.properties?.accountId).toBeTruthy();
    expect(accountCreate.requestBody?.content?.['application/json']?.schema?.required).toContain('accountId');
    const health = (api.paths['/v1/health']?.get ?? {}) as { security?: unknown[] };
    expect(health.security).toEqual([]);
    for (const c of CAPABILITIES) {
      const path = api.paths[c.http.path];
      expect(path, `path ${c.http.path}`).toBeTruthy();
      expect(path[c.http.method.toLowerCase()]).toBeTruthy();
    }
  });

  it('CLI spec 与能力一一对应', () => {
    const cli = buildCliSpec();
    expect(cli.length).toBe(CAPABILITIES.length);
    expect(cli.every((c) => c.command.startsWith('fuma '))).toBe(true);
    expect(new Set(cli.map((c) => c.command)).size).toBe(cli.length);
  });

  it('MCP spec 工具名唯一且含 schema', () => {
    const mcp = buildMcpSpec();
    expect(mcp.length).toBe(CAPABILITIES.length);
    expect(new Set(mcp.map((m) => m.name)).size).toBe(mcp.length);
    expect(mcp.every((m) => m.inputSchema.type === 'object')).toBe(true);
  });

  it('writeSpecFiles 产出三个文件', () => {
    const dir = mkdtempSync(join(tmpdir(), 'fuma-spec-'));
    const out = writeSpecFiles(dir);
    expect(existsSync(out.openapi)).toBe(true);
    expect(existsSync(out.cli)).toBe(true);
    expect(existsSync(out.mcp)).toBe(true);
  });
});
