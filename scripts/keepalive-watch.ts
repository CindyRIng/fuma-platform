#!/usr/bin/env node
/**
 * 24h 保活观察器（实验 E1）：每 5 分钟一次心跳，记录 token 剩余时间与结果。
 * 用法：FUMA_HOME=/tmp/fuma-dev node --experimental-sqlite --import tsx scripts/keepalive-watch.ts [--hours 30] [--out /tmp/keepalive.jsonl]
 * 结论读取：观察首次 ok=false/error=session_expired 的时间与 token 到期时间的关系。
 */
import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';
import { createRuntime } from '../src/services/runtime.js';

const args = process.argv.slice(2);
function argValue(name: string, def: string): string {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] ? args[i + 1] : def;
}
const hours = Number(argValue('--hours', '30'));
const out = argValue('--out', '/tmp/fuma-keepalive.jsonl');
const intervalMs = Math.max(60, Number(argValue('--interval', '300'))) * 1000;

mkdirSync(dirname(out), { recursive: true });
const home = process.env.FUMA_HOME ?? '/tmp/fuma-dev';
const rt = createRuntime({ home, silentConsole: true });
const accountId = rt.store.all<{ account_id: string }>('SELECT account_id FROM accounts ORDER BY created_at LIMIT 1')[0]?.account_id;
if (!accountId) {
  console.error('no account');
  process.exit(1);
}
const deadline = Date.now() + hours * 3600_000;
console.log(`keepalive-watch start account=${accountId} home=${home} interval=${intervalMs}ms hours=${hours} out=${out}`);

function log(obj: Record<string, unknown>): void {
  const line = JSON.stringify({ ts: new Date().toISOString(), ...obj });
  appendFileSync(out, line + '\n');
  console.log(line);
}

while (Date.now() < deadline) {
  const loaded = rt.sessions.loadTokens(accountId);
  const tokenExpire = loaded?.expiresAt ?? null;
  const started = Date.now();
  const r = await rt.sessions.heartbeat(accountId);
  log({
    accountId,
    ok: r.ok,
    latencyMs: r.latencyMs,
    error: r.error ?? null,
    tokenExpiresAt: tokenExpire,
    tokenRemainingSec: tokenExpire ? Math.round((Date.parse(tokenExpire) - Date.now()) / 1000) : null,
    durationMs: Date.now() - started
  });
  if (!r.ok && r.error === 'session_expired') {
    log({ event: 'session_expired_detected', accountId, tokenExpiresAt: tokenExpire });
    // 继续观察 15 分钟，确认持续失效，然后退出
    const stop = Date.now() + 15 * 60_000;
    while (Date.now() < stop) {
      await new Promise((res) => setTimeout(res, 60_000));
      const rr = await rt.sessions.heartbeat(accountId);
      log({ accountId, check: 'post-expiry', ok: rr.ok, error: rr.error ?? null });
    }
    break;
  }
  await new Promise((res) => setTimeout(res, intervalMs));
}
rt.close();
