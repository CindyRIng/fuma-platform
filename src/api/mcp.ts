import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { z } from 'zod';
import { CAPABILITIES } from './capabilities.js';
import { dispatch } from './dispatch.js';
import { errorEnvelope, okEnvelope } from './envelope.js';
import { newRequestId } from '../core/ids.js';
import { SPEC_VERSION, VERSION } from '../version.js';
import type { Runtime } from '../services/runtime.js';

function zodForCapability(params: Array<{ name: string; type: string; required?: boolean; description: string }>): Record<string, z.ZodTypeAny> {
  const shape: Record<string, z.ZodTypeAny> = {};
  for (const p of params) {
    let schema: z.ZodTypeAny;
    if (p.type === 'number') schema = z.number();
    else if (p.type === 'boolean') schema = z.boolean();
    else if (p.type === 'json') schema = z.record(z.string(), z.unknown());
    else schema = z.string();
    schema = schema.describe(p.description);
    shape[p.name] = p.required ? schema : schema.optional();
  }
  return shape;
}

export function createMcpServer(rt: Runtime): McpServer {
  const server = new McpServer({ name: 'fuma-platform', version: VERSION });

  for (const cap of CAPABILITIES) {
    if (!cap.implemented) continue;
    const toolName = cap.mcp.tool;
    const shape = zodForCapability(cap.params.map((p) => ({ name: p.name, type: p.type, required: p.required, description: p.description })));
    (server as any).registerTool(
      toolName,
      {
        title: cap.title,
        description: `${cap.description}\n\nCLI: fuma ${cap.noun} ${cap.verb}；REST: ${cap.http.method} ${cap.http.path}`,
        inputSchema: shape as never
      },
      async (args: Record<string, unknown>) => {
        const requestId = newRequestId();
        const started = Date.now();
        try {
          const data = await dispatch(rt, cap.id, args ?? {}, { requestId, actor: 'mcp' });
          const env = okEnvelope(data, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started });
          return { content: [{ type: 'text' as const, text: JSON.stringify(env, null, 2) }] };
        } catch (err) {
          const env = errorEnvelope(err, { requestId, specVersion: SPEC_VERSION, durationMs: Date.now() - started });
          return { content: [{ type: 'text' as const, text: JSON.stringify(env, null, 2) }], isError: true };
        }
      }
    );
  }

  (server as any).registerTool(
    'fuma_system_capabilities',
    {
      title: '能力清单',
      description: '列出全部能力（含阶段/实现状态/CLI/REST/MCP 映射）',
      inputSchema: {
        includeUnimplemented: z.boolean().optional().describe('是否包含未实现能力（默认 false）')
      }
    },
    async (args: Record<string, unknown>) => {
      const data = CAPABILITIES
        .filter((c) => args.includeUnimplemented || c.implemented)
        .map((c) => ({ id: c.id, title: c.title, phase: c.phase, implemented: c.implemented, cli: `fuma ${c.noun} ${c.verb}`, rest: `${c.http.method} ${c.http.path}`, mcp: c.mcp.tool }));
      return { content: [{ type: 'text' as const, text: JSON.stringify({ ok: true, data }, null, 2) }] };
    }
  );

  return server;
}

export async function startMcpServer(rt: Runtime): Promise<void> {
  const server = createMcpServer(rt);
  const transport = new StdioServerTransport();
  await server.connect(transport);
  rt.logger.info('MCP server started (stdio)', { version: VERSION });
}
