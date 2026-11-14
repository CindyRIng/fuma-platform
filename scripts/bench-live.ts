#!/usr/bin/env node
/** 真实上游延迟基准（只读；使用已登录账号的本地 token）。运行：FUMA_HOME=/tmp/fuma-dev node --experimental-sqlite --import tsx scripts/bench-live.ts */
import { createRuntime } from '../src/services/runtime.js';
import { listCustomers, getCustomer } from '../src/services/customers.js';
import { listOpenSea } from '../src/services/open-sea.js';
import { dedupCheck } from '../src/services/dedup.js';
import { listFollowups } from '../src/services/followups.js';
import { customsQuery } from '../src/services/customs.js';

const rt = createRuntime({ home: process.env.FUMA_HOME ?? '/tmp/fuma-dev', silentConsole: true });
const accountId = rt.store.all<{ account_id: string }>('SELECT account_id FROM accounts LIMIT 1')[0]?.account_id;
if (!accountId) { console.error('no account'); process.exit(1); }
const pct = (arr: number[], p: number) => { const s = [...arr].sort((a, b) => a - b); return s[Math.min(s.length - 1, Math.floor((p / 100) * s.length))] ?? 0; };
async function measure(name: string, fn: (i: number) => Promise<unknown>, n = 5) {
  const lat: number[] = [];
  for (let i = 0; i < n; i++) { const t = performance.now(); await fn(i); lat.push(performance.now() - t); }
  console.log(JSON.stringify({ name, n, p50: +pct(lat, 50).toFixed(1), p95: +pct(lat, 95).toFixed(1) }));
}
const first = rt.store.get<{ customer_id: string }>('SELECT customer_id FROM customers WHERE account_id=? LIMIT 1', accountId)?.customer_id ?? '873590689807446016';
await measure('customer.list(fresh)', () => listCustomers(rt, { accountId, pageSize: 20, fresh: true }));
await measure('customer.get(fresh)', () => getCustomer(rt, { customerId: first, accountId, fresh: true }));
await measure('open_sea.list', () => listOpenSea(rt, { accountId, pageSize: 20 }));
await measure('followup.list', () => listFollowups(rt, { accountId, pageSize: 20 }));
await measure('dedup.check', () => dedupCheck(rt, { accountId, keywords: '河北高迪管道设备制造有限公司' }));
const cold: number[] = []; const warm: number[] = [];
for (let i = 0; i < 5; i++) {
  const kw = `LiveBench${Date.now()}${i}`;
  let t = performance.now();
  await customsQuery(rt, { accountId, inputCompany: kw, pageSize: 5 });
  cold.push(performance.now() - t);
  t = performance.now();
  await customsQuery(rt, { accountId, inputCompany: kw, pageSize: 5 });
  warm.push(performance.now() - t);
}
console.log(JSON.stringify({ name: 'customs.query', coldP50: +pct(cold, 50).toFixed(1), coldP95: +pct(cold, 95).toFixed(1), cacheP50: +pct(warm, 50).toFixed(1), cacheP95: +pct(warm, 95).toFixed(1) }));
rt.close();
