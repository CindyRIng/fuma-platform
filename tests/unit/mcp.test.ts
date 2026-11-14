import { describe, expect, it } from 'vitest';
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../../src/services/runtime.js';
import { createMcpServer } from '../../src/api/mcp.js';
import { CAPABILITIES } from '../../src/api/capabilities.js';

describe('MCP', () => {
  it('工具注册不重复（fuma_system_capabilities 只能注册一次）', () => {
    const home = mkdtempSync(join(tmpdir(), 'fuma-mcp-'));
    const rt = createRuntime({ home, silentConsole: true });
    let server: ReturnType<typeof createMcpServer> | null = null;
    expect(() => { server = createMcpServer(rt); }).not.toThrow();
    const tools = ((server as unknown as { _registeredTools?: Record<string, unknown> })?._registeredTools) ?? {};
    const names = Object.keys(tools);
    if (names.length) {
      const unique = new Set(names);
      expect(unique.size).toBe(names.length);
      const implemented = CAPABILITIES.filter((c) => c.implemented).length;
      expect(names.length).toBeGreaterThanOrEqual(implemented);
    }
    rt.close();
  });
});
