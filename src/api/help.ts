import { CAPABILITIES, capabilitiesByNoun, type Capability, type ParamSpec } from './capabilities.js';
import { VERSION, SPEC_VERSION } from '../version.js';

export function renderCapabilityMarkdown(c: Capability): string {
  const lines: string[] = [];
  lines.push(`## ${c.id}`);
  lines.push('');
  lines.push(`**${c.title}** — ${c.summary}`);
  lines.push('');
  lines.push(c.description);
  lines.push('');
  lines.push(`- 分类：${c.category}`);
  lines.push(`- 阶段：${c.phase}｜变更性：${c.mutating ? '是（写）' : '否（读）'}｜已实现：${c.implemented ? '是' : '否'}`);
  lines.push(`- CLI：\`fuma ${c.noun} ${c.verb}\``);
  lines.push(`- REST：\`${c.http.method} ${c.http.path}\``);
  lines.push(`- MCP：\`${c.mcp.tool}\``);
  lines.push('');
  if (c.params.length) {
    lines.push('| 参数 | 类型 | 必填 | 说明 |');
    lines.push('|---|---|---|---|');
    for (const p of c.params) {
      lines.push(`| ${p.in === 'arg' ? p.name : (p.flags ?? `--${p.name}`)} | ${p.type} | ${p.required ? '是' : '否'} | ${p.description}${p.default !== undefined ? `（默认 ${JSON.stringify(p.default)}）` : ''} |`);
    }
    lines.push('');
  } else {
    lines.push('无参数。');
    lines.push('');
  }
  lines.push('```bash');
  lines.push(c.example);
  lines.push('```');
  lines.push('');
  return lines.join('\n');
}

export function renderAllCapabilitiesMarkdown(): string {
  const lines: string[] = [];
  lines.push(`# fuma-platform 能力参考`);
  lines.push('');
  lines.push(`版本：${VERSION}｜specVersion：${SPEC_VERSION}｜能力数：${CAPABILITIES.length}`);
  lines.push('');
  lines.push('| 能力 | 标题 | 阶段 | CLI | REST | MCP |');
  lines.push('|---|---|---|---|---|---|');
  for (const c of CAPABILITIES) {
    lines.push(`| ${c.id} | ${c.title} | ${c.phase} | \`fuma ${c.noun} ${c.verb}\` | \`${c.http.method} ${c.http.path}\` | \`${c.mcp.tool}\` |`);
  }
  lines.push('');
  for (const [, caps] of capabilitiesByNoun()) {
    for (const c of caps) lines.push(renderCapabilityMarkdown(c));
  }
  return lines.join('\n');
}

export function renderCliHelp(): string {
  const lines: string[] = [];
  lines.push('fuma-platform CLI');
  lines.push('');
  lines.push(`版本 ${VERSION}（spec ${SPEC_VERSION}）`);
  lines.push('');
  lines.push('用法：fuma <noun> <verb> [options]');
  lines.push('      fuma serve | mcp | spec | docs | doctor | backup | version');
  lines.push('');
  lines.push('全局选项：--home <dir>  --format json|table  --quiet  --debug');
  lines.push('');
  lines.push('能力分组：');
  for (const [noun, caps] of capabilitiesByNoun()) {
    lines.push(`  ${noun.padEnd(10)} ${caps.map((c) => c.verb).join(', ')}`);
  }
  lines.push('');
  lines.push('示例：fuma system health');
  lines.push('      fuma account list');
  lines.push('      fuma docs account.list');
  return lines.join('\n');
}

export function tableFormat(rows: Array<Record<string, unknown>>, columns?: string[]): string {
  if (!rows.length) return '(empty)';
  const cols = columns ?? Object.keys(rows[0]).slice(0, 8);
  const widths = cols.map((c) => Math.max(c.length, ...rows.map((r) => String(r[c] ?? '').length)));
  const head = cols.map((c, i) => c.padEnd(widths[i])).join('  ');
  const sep = widths.map((w) => '-'.repeat(w)).join('  ');
  const body = rows.map((r) => cols.map((c, i) => String(r[c] ?? '').padEnd(widths[i])).join('  '));
  return [head, sep, ...body].join('\n');
}

export function renderRestDocsHtml(baseUrl: string): string {
  const rows = CAPABILITIES.map((c) => `<tr><td><code>${c.http.method}</code></td><td><code>${c.http.path}</code></td><td>${c.title}<br><small>${c.summary}</small></td><td><code>fuma ${c.noun} ${c.verb}</code></td><td>${c.phase}</td></tr>`).join('\n');
  return `<!doctype html>
<html lang="zh-CN"><head><meta charset="utf-8"><title>fuma-platform API</title>
<style>body{font-family:system-ui,sans-serif;margin:2rem;color:#222}table{border-collapse:collapse;width:100%}td,th{border:1px solid #ddd;padding:6px 8px;vertical-align:top}th{background:#f4f4f4}code{background:#f6f8fa;padding:1px 4px;border-radius:3px}</style>
</head><body>
<h1>fuma-platform REST API</h1>
<p>版本 ${VERSION}｜specVersion ${SPEC_VERSION}｜<a href="${baseUrl}/v1/openapi.json">OpenAPI JSON</a>｜<a href="${baseUrl}/v1/spec/cli.json">CLI spec</a>｜<a href="${baseUrl}/v1/spec/mcp.json">MCP spec</a></p>
<p>统一 envelope：<code>{ok, data, meta, error}</code>；鉴权：<code>Authorization: Bearer &lt;apiToken&gt;</code>（<code>/v1/health</code>、<code>/v1/docs</code> 除外）。</p>
<table><thead><tr><th>方法</th><th>路径</th><th>说明</th><th>CLI</th><th>阶段</th></tr></thead><tbody>
${rows}
</tbody></table>
</body></html>`;
}
