#!/usr/bin/env node
/**
 * 生成物：spec/*.json + docs/generated/{CLI参考,REST-API,MCP工具}.md
 * 运行：npm run docs:gen
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { buildCliSpec, buildMcpSpec, buildOpenApi, writeSpecFiles } from '../src/api/spec.js';
import { renderAllCapabilitiesMarkdown } from '../src/api/help.js';
import { CAPABILITIES } from '../src/api/capabilities.js';
import { VERSION, SPEC_VERSION } from '../src/version.js';

const root = resolve(process.cwd());
const genDir = resolve(root, 'docs', 'generated');
mkdirSync(genDir, { recursive: true });
const spec = writeSpecFiles(resolve(root, 'spec'));

const cli = buildCliSpec();
const cliMd: string[] = [];
cliMd.push(`# CLI 参考（fuma）`);
cliMd.push('');
cliMd.push(`> 版本 ${VERSION}｜spec ${SPEC_VERSION}｜由 \`npm run docs:gen\` 生成，请勿手改。`);
cliMd.push('');
cliMd.push('全局选项：`--home <dir>`、`--format json|table`、`--quiet`、`--debug`、`--json`（单命令强制 JSON）。');
cliMd.push('');
cliMd.push('常用特殊命令：`fuma serve`、`fuma mcp`、`fuma spec`、`fuma docs`、`fuma doctor`、`fuma backup`、`fuma version`。');
cliMd.push('');
cliMd.push('## 命令一览');
cliMd.push('');
cliMd.push('| 命令 | 说明 | 阶段 | 已实现 |');
cliMd.push('|---|---|---|---|');
for (const c of cli) cliMd.push(`| \`${c.command}\` | ${c.title}：${c.summary} | ${c.phase} | ${c.implemented ? '✅' : '—'} |`);
cliMd.push('');
cliMd.push('## 命令详情');
cliMd.push('');
for (const c of CAPABILITIES) {
  cliMd.push(`### ${c.command}`);
  cliMd.push('');
  cliMd.push(`**${c.title}** — ${c.summary}`);
  cliMd.push('');
  cliMd.push(c.description);
  cliMd.push('');
  if (c.params.length) {
    cliMd.push('| 参数 | 类型 | 必填 | 说明 |');
    cliMd.push('|---|---|---|---|');
    for (const p of c.params) cliMd.push(`| ${p.in === 'arg' ? `\`${p.name}\`` : `\`${p.flags ?? `--${p.name}`}\``} | ${p.type} | ${p.required ? '是' : '否'} | ${p.description}${p.default !== undefined ? `（默认 \`${JSON.stringify(p.default)}\`）` : ''} |`);
    cliMd.push('');
  }
  cliMd.push('```bash');
  cliMd.push(c.example);
  cliMd.push('```');
  cliMd.push('');
}
writeFileSync(resolve(genDir, 'CLI参考.md'), cliMd.join('\n'));

const restMd: string[] = [];
restMd.push('# REST API 参考');
restMd.push('');
restMd.push(`> 版本 ${VERSION}｜OpenAPI: \`spec/openapi.json\`｜服务地址默认 \`http://127.0.0.1:17890\`。`);
restMd.push('');
restMd.push('鉴权：`Authorization: Bearer <apiToken>`（`/v1/health`、`/v1/docs`、`/v1/openapi.json`、`/v1/spec/*` 免鉴权）。');
restMd.push('');
restMd.push('统一响应 envelope：');
restMd.push('');
restMd.push('```json');
restMd.push('{ "ok": true, "data": {}, "meta": { "requestId": "req_...", "specVersion": "...", "durationMs": 12 }, "error": null }');
restMd.push('```');
restMd.push('');
restMd.push('| 方法 | 路径 | 说明 | 能力 | 阶段 |');
restMd.push('|---|---|---|---|---|');
for (const c of CAPABILITIES) restMd.push(`| ${c.http.method} | \`${c.http.path}\` | ${c.title}：${c.summary} | \`${c.id}\` | ${c.phase} |`);
restMd.push('');
restMd.push('## 参数');
restMd.push('');
for (const c of CAPABILITIES) {
  restMd.push(`### ${c.http.method} ${c.http.path}`);
  restMd.push('');
  restMd.push(c.description);
  restMd.push('');
  if (!c.params.length) { restMd.push('无参数。'); restMd.push(''); continue; }
  restMd.push('| 参数 | 位置 | 类型 | 必填 | 说明 |');
  restMd.push('|---|---|---|---|---|');
  for (const p of c.params) restMd.push(`| \`${p.name}\` | ${p.in === 'arg' ? 'path/query' : (c.http.method === 'GET' ? 'query' : 'body')} | ${p.type} | ${p.required ? '是' : '否'} | ${p.description} |`);
  restMd.push('');
}
writeFileSync(resolve(genDir, 'REST-API.md'), restMd.join('\n'));

const mcp = buildMcpSpec();
const mcpMd: string[] = [];
mcpMd.push('# MCP 工具参考');
mcpMd.push('');
mcpMd.push(`> 版本 ${VERSION}｜stdio 运行：\`fuma mcp\`｜共 ${mcp.length} 个工具（已实现 ${mcp.filter((m) => m.implemented).length} 个）。`);
mcpMd.push('');
mcpMd.push('| 工具 | 说明 | 阶段 | 已实现 |');
mcpMd.push('|---|---|---|---|');
for (const m of mcp) mcpMd.push(`| \`${m.name}\` | ${m.title} | ${m.phase} | ${m.implemented ? '✅' : '—'} |`);
mcpMd.push('');
mcpMd.push('工具返回值为 JSON envelope 文本（与 REST 一致），失败时 `isError=true`。');
mcpMd.push('');
for (const t of mcp) {
  mcpMd.push(`## ${t.name}`);
  mcpMd.push('');
  mcpMd.push(t.description);
  mcpMd.push('');
  mcpMd.push('```json');
  mcpMd.push(JSON.stringify(t.inputSchema, null, 2));
  mcpMd.push('```');
  mcpMd.push('');
}
writeFileSync(resolve(genDir, 'MCP工具.md'), mcpMd.join('\n'));

writeFileSync(resolve(genDir, '能力总览.md'), renderAllCapabilitiesMarkdown());
console.log(JSON.stringify({ ok: true, data: { spec, docs: ['CLI参考.md', 'REST-API.md', 'MCP工具.md', '能力总览.md'] } }, null, 2));
