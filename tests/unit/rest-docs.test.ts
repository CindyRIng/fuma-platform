import { afterAll, describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { startRestServer } from '../../src/api/rest.js';

const home = mkdtempSync(join(tmpdir(), 'fuma-rest-docs-'));
const rt = createRuntime({ home, silentConsole: true });
let url = '';
let close: (() => void) | null = null;

describe('REST docs', () => {
  it('启动服务', async () => {
    const started = await startRestServer(rt, { host: '127.0.0.1', port: 0 });
    url = started.url;
    close = () => started.server.close();
    expect(url).toMatch(/^http:\/\/127\.0\.0\.1:\d+$/);
  });

  it('/v1/docs 返回 Swagger UI 页面', async () => {
    const res = await fetch(`${url}/v1/docs`);
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain('swagger-ui-bundle.js');
    expect(html).toContain('SwaggerUIBundle');
    expect(html).toContain('/v1/openapi.json');
  });

  it('Swagger 静态资源本地可访问', async () => {
    for (const [path, type] of [['swagger-ui.css', 'text/css'], ['swagger-ui-bundle.js', 'javascript'], ['swagger-ui-standalone-preset.js', 'javascript']] as Array<[string, string]>) {
      const res = await fetch(`${url}/v1/docs/${path}`);
      expect(res.status, path).toBe(200);
      expect(res.headers.get('content-type') ?? '').toContain(type);
      expect((await res.text()).length).toBeGreaterThan(1000);
    }
  });

  it('OpenAPI 为标准 3.0.3 且公开', async () => {
    const res = await fetch(`${url}/v1/openapi.json`);
    expect(res.status).toBe(200);
    const api = (await res.json()) as { openapi: string; info: { title: string } };
    expect(api.openapi).toBe('3.0.3');
    expect(api.info.title).toBe('fuma-platform API');
  });

  it('业务接口未带 token 返回 401 envelope', async () => {
    const res = await fetch(`${url}/v1/accounts`);
    expect(res.status).toBe(401);
    const body = (await res.json()) as { ok: boolean; error?: { code?: string } };
    expect(body.ok).toBe(false);
    expect(body.error?.code).toBe('unauthorized');
  });

  afterAll(() => { close?.(); rt.close(); });
});
