#!/usr/bin/env node
/**
 * 性能基准（不访问真实上游；使用 mock upstream + 临时 DB）。
 * 运行：npm run bench
 */
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createRuntime } from '../src/services/runtime.js';
import { createAccount } from '../src/services/accounts.js';
import { UpstreamClient } from '../src/upstream/client.js';
import { listCustomers } from '../src/services/customers.js';
import { customsQuery } from '../src/services/customs.js';
import { claim } from '../src/services/writes.js';
import { processOutboxOnce } from '../src/services/sync.js';

const LATENCY_MS = 2;
const N_ACCOUNTS = 50;

function pct(values: number[], p: number): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length))];
}

function mockUpstream(): UpstreamClient {
  const delay = () => new Promise((r) => setTimeout(r, LATENCY_MS));
  return new UpstreamClient(
    { baseUrl: 'https://mock.test', pcapiPrefix: '/pcapi', companyId: 10264, timeoutMs: 5000, userAgent: 'bench', language: 'zh-CN' },
    async (url) => {
      await delay();
      const u = String(url);
      if (u.includes('get_detail_info')) {
        return new Response(JSON.stringify({ code: '0', data: [{ key_id: 'C1', custName: 'BENCHCO', seasFlag: 1, ownerCtId: 13148056 }] }), { status: 200 });
      }
      if (u.includes('repeat/check')) return new Response(JSON.stringify({ code: '0', data: { count: '0' } }), { status: 200 });
      if (u.includes('GetTradeUpdateLog')) return new Response(JSON.stringify({ code: '0', data: { AllCount: 1 } }), { status: 200 });
      if (u.includes('tradeList')) return new Response(JSON.stringify({ code: '0', data: { allcount: 1000, exactCount: 1, data: [{ tradeno: 'T', importer: 'X' }] } }), { status: 200 });
      if (u.includes('get_page_list')) {
        const list = Array.from({ length: 20 }, (_, i) => ({ key_id: `C${i}`, custName: `BENCHCO_${i}`, ownerCtId: 13148056, seasFlag: 0 }));
        return new Response(JSON.stringify({ code: '0', data: { totalNum: 5000, list } }), { status: 200 });
      }
      return new Response(JSON.stringify({ code: '0', data: '' }), { status: 200 });
    }
  );
}

async function benchReads(): Promise<{ count: number; p50: number; p95: number; qps: number }> {
  const home = mkdtempSync(join(tmpdir(), 'fuma-bench-'));
  const rt = createRuntime({ home, silentConsole: true });
  rt.config.pool.ratePerSecond = { read: 1000, write: 1000 };
  rt.config.pool.jitterMs = [0, 0];
  (rt as unknown as { upstream: UpstreamClient }).upstream = mockUpstream();
  for (let i = 0; i < N_ACCOUNTS; i++) {
    const id = `acct_${String(i).padStart(2, '0')}`;
    createAccount(rt, { accountId: id, ownerCtId: '13148056' });
    rt.store.run(
      `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at,ct_id,c_id) VALUES(?,?,?,?,?,?,?,?,?)`,
      id, 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), Date.now() + 3600_000, new Date().toISOString(), 13148056, 10264
    );
  }
  const lat: number[] = [];
  const start = Date.now();
  const N = 200;
  for (let i = 0; i < N; i++) {
    const t0 = performance.now();
    await listCustomers(rt, { accountId: `acct_${String(i % N_ACCOUNTS).padStart(2, '0')}`, pageSize: 20, fresh: true });
    lat.push(performance.now() - t0);
  }
  const elapsed = Date.now() - start;
  const result = { count: N, p50: pct(lat, 50), p95: pct(lat, 95), qps: (N / elapsed) * 1000 };
  rt.close();
  return result;
}

async function benchCustomsCache(): Promise<{ upstream: { p50: number; p95: number }; cache: { p50: number; p95: number; hitRate: number }; entries: number }> {
  const home = mkdtempSync(join(tmpdir(), 'fuma-bench-cache-'));
  const rt = createRuntime({ home, silentConsole: true });
  rt.config.pool.ratePerSecond = { read: 5000, write: 5000 };
  rt.config.pool.jitterMs = [0, 0];
  (rt as unknown as { upstream: UpstreamClient }).upstream = mockUpstream();
  createAccount(rt, { accountId: 'acct_01' });
  rt.store.run(
    `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at,ct_id,c_id) VALUES(?,?,?,?,?,?,?,?,?)`,
    'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), Date.now() + 3600_000, new Date().toISOString(), 13148056, 10264
  );
  const up: number[] = [];
  const ca: number[] = [];
  for (let i = 0; i < 50; i++) {
    const t0 = performance.now();
    await customsQuery(rt, { accountId: 'acct_01', inputCompany: `BENCHCO_${i}`, pageSize: 20 });
    up.push(performance.now() - t0);
  }
  let hits = 0;
  for (let i = 0; i < 500; i++) {
    const t0 = performance.now();
    const r = await customsQuery(rt, { accountId: 'acct_01', inputCompany: `BENCHCO_${i % 50}`, pageSize: 20 });
    ca.push(performance.now() - t0);
    if (r.cached) hits++;
  }
  const entries = Number(rt.store.get<{ c: number }>('SELECT COUNT(*) AS c FROM customs_cache_entries')?.c ?? 0);
  rt.close();
  return { upstream: { p50: pct(up, 50), p95: pct(up, 95) }, cache: { p50: pct(ca, 50), p95: pct(ca, 95), hitRate: (hits / 500) * 100 }, entries };
}

async function benchOutbox(): Promise<{ ops: number; ms: number; opsPerSec: number }> {
  const home = mkdtempSync(join(tmpdir(), 'fuma-bench-sync-'));
  const rt = createRuntime({ home, silentConsole: true });
  rt.config.pool.ratePerSecond = { read: 5000, write: 5000 };
  rt.config.pool.jitterMs = [0, 0];
  (rt as unknown as { upstream: UpstreamClient }).upstream = mockUpstream();
  createAccount(rt, { accountId: 'acct_01', ownerCtId: '13148056' });
  rt.store.run(
    `INSERT INTO sessions(account_id,state,mode,access_token_enc,individual_token_enc,token_expire_at,updated_at,ct_id,c_id) VALUES(?,?,?,?,?,?,?,?,?)`,
    'acct_01', 'online', 'dingtalk_sso_qr', rt.box.encrypt('AT'), rt.box.encrypt('IAT'), Date.now() + 3600_000, new Date().toISOString(), 13148056, 10264
  );
  const N = 100;
  for (let i = 0; i < N; i++) {
    await claim(rt, { accountId: 'acct_01', customerId: `C${i}` });
  }
  const start = Date.now();
  let done = 0;
  while (done < N) {
    const r = await processOutboxOnce(rt, 50);
    done += r.processed;
    if (r.processed === 0) break;
  }
  const ms = Date.now() - start;
  rt.close();
  return { ops: done, ms, opsPerSec: (done / ms) * 1000 };
}

async function main(): Promise<void> {
  console.log('bench: reading customers (50 accounts, 200 reads)...');
  const reads = await benchReads();
  console.log('bench: customs cache (50 upstream + 500 hits)...');
  const cache = await benchCustomsCache();
  console.log('bench: outbox sync (100 claims)...');
  const outbox = await benchOutbox();
  const report = { generatedAt: new Date().toISOString(), node: process.version, accounts: N_ACCOUNTS, reads, cache, outbox };
  console.log(JSON.stringify(report, null, 2));
}

await main();
