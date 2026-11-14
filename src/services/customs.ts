import { gzipSync, gunzipSync } from 'node:zlib';
import { AppError } from '../core/errors.js';
import { sha256Hex } from '../core/ids.js';
import { nowIso } from '../core/time.js';
import { poolOf } from '../pool/request-pool.js';
import type { Runtime } from './runtime.js';
import { assertCompanyOnly } from './mappers.js';

export interface CustomsQueryInput {
  accountId?: string;
  inputCompany: string;
  companyFlag?: number | string;
  page?: number | string;
  pageSize?: number | string;
  forceRefresh?: boolean;
  allowStale?: boolean;
  sortColumn?: string;
  sortType?: 'asc' | 'desc';
}

export interface CustomsQueryResult {
  list: Array<Record<string, unknown>>;
  totalNum: number;
  exactCount: number;
  allCount: number;
  source: 'upstream' | 'cache';
  cached: boolean;
  cachedAt: string | null;
  expiresAt: string | null;
  stale: boolean;
  upstreamVersion: string | null;
  page: number;
  pageSize: number;
}

interface TradeListResponse {
  exactCount?: number;
  allcount?: number;
  data?: Array<Record<string, unknown>>;
}

interface CacheRow {
  cache_key: string;
  query_type: string;
  result_json: Buffer | string | null;
  result_encoding: string;
  total_num: number | null;
  upstream_version: string | null;
  fetched_at: string;
  expires_at: string;
  stale: number;
  hit_count: number;
}

const CACHE_META_WATERMARK = 'update_log_all_count';

function permissionScope(accountId: string | undefined): string {
  return accountId ? `acct:${accountId}` : 'shared';
}

function normalizedCompany(k: string): string {
  return k.trim().toLowerCase().replace(/\s+/g, ' ');
}

function cacheKeyOf(parts: Record<string, unknown>): string {
  return sha256Hex(JSON.stringify(parts));
}

function decodeResult(row: CacheRow): Array<Record<string, unknown>> | null {
  try {
    const raw = row.result_json;
    if (!raw) return null;
    const buf = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw);
    const text = row.result_encoding === 'gzip' ? gunzipSync(buf).toString('utf8') : buf.toString('utf8');
    const parsed = JSON.parse(text) as { list?: Array<Record<string, unknown>> };
    return parsed.list ?? [];
  } catch {
    return null;
  }
}

function readCache(rt: Runtime, key: string): CacheRow | undefined {
  return rt.store.get<CacheRow>('SELECT * FROM customs_cache_entries WHERE cache_key=?', key);
}

function isFresh(row: CacheRow): boolean {
  return Date.parse(row.expires_at) > Date.now();
}

function touchCache(rt: Runtime, key: string): void {
  rt.store.run('UPDATE customs_cache_entries SET hit_count=hit_count+1, last_used_at=? WHERE cache_key=?', nowIso(), key);
}

function writeCache(rt: Runtime, cfg: { key: string; params: Record<string, unknown>; scope: string; page: number; pageSize: number; result: TradeListResponse; watermark: string | null }): void {
  const listText = JSON.stringify({ list: cfg.result.data ?? [] });
  const gz = gzipSync(Buffer.from(listText, 'utf8'));
  const ttlMs = Math.max(60, rt.config.customs.resultTtlSeconds) * 1000;
  const now = Date.now();
  rt.store.run(
    `INSERT INTO customs_cache_entries(cache_key,query_type,params_hash,params_json,page_index,page_size,permission_scope,result_json,result_encoding,result_bytes,total_num,upstream_version,fetched_at,expires_at,stale,hit_count,last_used_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)
     ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json, result_bytes=excluded.result_bytes, total_num=excluded.total_num,
       upstream_version=excluded.upstream_version, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at, stale=excluded.stale`,
    cfg.key, 'company', sha256Hex(JSON.stringify(cfg.params)), JSON.stringify(cfg.params), cfg.page, cfg.pageSize, cfg.scope,
    gz, 'gzip', gz.byteLength, Number(cfg.result.allcount ?? 0), cfg.watermark,
    new Date(now).toISOString(), new Date(now + ttlMs).toISOString(), 0, 0, new Date(now).toISOString()
  );
}

/** 读取（或刷新）上游更新日志水位，用于缓存失效判断（节流）。 */
async function watermark(rt: Runtime, accountId: string, force = false): Promise<string | null> {
  const meta = rt.store.get<{ v: string; updated_at: string }>('SELECT v, updated_at FROM customs_cache_meta WHERE k=?', CACHE_META_WATERMARK);
  const checkSec = Math.max(60, rt.config.customs.updateLogCheckSeconds);
  if (meta && !force && Date.now() - Date.parse(meta.updated_at) < checkSec * 1000) return meta.v;
  try {
    const pool = poolOf(rt);
    const data = await pool.runRead(accountId, (ctx) => rt.upstream.call<{ AllCount?: number | string }>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
      method: 'GET', path: '/tradeData/api/V2/Account/GetTradeUpdateLog', timeoutMs: 15_000
    }));
    const v = String(data?.AllCount ?? '');
    if (v) {
      rt.store.run(
        `INSERT INTO customs_cache_meta(k,v,updated_at) VALUES(?,?,?)
         ON CONFLICT(k) DO UPDATE SET v=excluded.v, updated_at=excluded.updated_at`,
        CACHE_META_WATERMARK, v, nowIso()
      );
    }
    return v || null;
  } catch {
    return meta?.v ?? null;
  }
}

function buildTradeListBody(input: CustomsQueryInput, page: number, pageSize: number): Record<string, unknown> {
  const company = input.inputCompany.trim();
  return {
    inputCompany: company,
    companyFlag: Number(input.companyFlag ?? 1),
    smartSearchFlag: 1,
    filterForwarderImp: false,
    filterForwarderExp: false,
    importerName: { orList: [company], notList: [], andList: [], orRawName: 1, otherNameAndOr: 0 },
    exporterName: { orList: [company], notList: [], andList: [], orRawName: 1, otherNameAndOr: 0 },
    notifyName: { searchName: [company], otherNameAndOr: 0 },
    manufacturer: { searchName: [company], otherNameAndOr: 0 },
    brandName: { searchName: [company], otherNameAndOr: 0 },
    companyTradeListTab: 0,
    pageIndex: page,
    pageSize,
    sortColumn: input.sortColumn ?? 'lasttradedate',
    sortType: input.sortType ?? 'desc'
  };
}

/** 海关「按公司查询」：强制本地缓存（FR-H-06~09）。 */
export async function customsQuery(rt: Runtime, input: CustomsQueryInput): Promise<CustomsQueryResult> {
  assertCompanyOnly('company');
  const company = String(input.inputCompany ?? '').trim();
  if (company.length < 2) throw new AppError('invalid_argument', 'inputCompany 至少 2 个字符');
  const page = Math.max(1, Number(input.page ?? 1) || 1);
  const pageSize = Math.max(1, Math.min(100, Number(input.pageSize ?? 20) || 20));
  const scope = permissionScope(input.accountId);
  const key = cacheKeyOf({
    qt: 'company', company: normalizedCompany(company), flag: Number(input.companyFlag ?? 1),
    page, pageSize, sortColumn: input.sortColumn ?? 'lasttradedate', sortType: input.sortType ?? 'desc', scope
  });
  const row = readCache(rt, key);
  const allowStale = input.allowStale !== false;

  if (row && !input.forceRefresh) {
    const list = decodeResult(row);
    if (list !== null && isFresh(row)) {
      touchCache(rt, key);
      return {
        list, totalNum: Number(row.total_num ?? 0), exactCount: 0, allCount: Number(row.total_num ?? 0),
        source: 'cache', cached: true, cachedAt: row.fetched_at, expiresAt: row.expires_at, stale: false,
        upstreamVersion: row.upstream_version, page, pageSize
      };
    }
  }

  let accountId: string;
  try {
    const pool = poolOf(rt);
    accountId = pool.resolveReadAccount(input.accountId).accountId;
  } catch (err) {
    // 无可用会话：允许返回 stale 缓存
    if (row && allowStale) {
      const list = decodeResult(row);
      if (list !== null) {
        touchCache(rt, key);
        return {
          list, totalNum: Number(row.total_num ?? 0), exactCount: 0, allCount: Number(row.total_num ?? 0),
          source: 'cache', cached: true, cachedAt: row.fetched_at, expiresAt: row.expires_at, stale: true,
          upstreamVersion: row.upstream_version, page, pageSize
        };
      }
    }
    throw err;
  }

  const wm = await watermark(rt, accountId);
  const cacheInvalidByVersion = !!(row && wm && row.upstream_version && row.upstream_version !== wm);
  if (row && cacheInvalidByVersion) {
    rt.store.run('UPDATE customs_cache_entries SET stale=1 WHERE cache_key=?', key);
  }

  const pool = poolOf(rt);
  try {
    const result = await pool.runRead(accountId, (ctx) => rt.upstream.call<TradeListResponse>({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
      method: 'POST', path: '/findServer/customs/customsNewV1/tradeList',
      body: buildTradeListBody(input, page, pageSize),
      timeoutMs: 30_000
    }));
    writeCache(rt, { key, params: { company: normalizedCompany(company), companyFlag: Number(input.companyFlag ?? 1), page, pageSize, scope }, scope, page, pageSize, result, watermark: wm });
    return {
      list: result.data ?? [], totalNum: Number(result.allcount ?? result.data?.length ?? 0),
      exactCount: Number(result.exactCount ?? 0), allCount: Number(result.allcount ?? 0),
      source: 'upstream', cached: false, cachedAt: null, expiresAt: null, stale: false,
      upstreamVersion: wm, page, pageSize
    };
  } catch (err) {
    if (row && allowStale) {
      const list = decodeResult(row);
      if (list !== null) {
        touchCache(rt, key);
        rt.store.run('UPDATE customs_cache_entries SET last_error=? WHERE cache_key=?', String(err instanceof Error ? err.message : err).slice(0, 300), key);
        return {
          list, totalNum: Number(row.total_num ?? 0), exactCount: 0, allCount: Number(row.total_num ?? 0),
          source: 'cache', cached: true, cachedAt: row.fetched_at, expiresAt: row.expires_at, stale: true,
          upstreamVersion: row.upstream_version, page, pageSize
        };
      }
    }
    throw err;
  }
}

export type CustomsDictKind = 'countries' | 'hscode' | 'sources' | 'updatelog';

const DICT_PATHS: Record<CustomsDictKind, { method: 'GET'; path: string; query?: Record<string, unknown> }> = {
  countries: { method: 'GET', path: '/tradeData/api/V1/dataSource/allCountry', query: { searchKeyword: '' } },
  hscode: { method: 'GET', path: '/tradeData/standard/hscode' },
  sources: { method: 'GET', path: '/tradeData/api/V1/dataSource/importExportCount' },
  updatelog: { method: 'GET', path: '/tradeData/api/V2/Account/GetTradeUpdateLog' }
};

export async function customsDictionaries(rt: Runtime, input: { accountId?: string; kind?: string }): Promise<{ kind: string; data: unknown; source: 'cache' | 'upstream'; cachedAt: string | null }> {
  const kind = (input.kind ?? 'countries') as CustomsDictKind;
  const ep = DICT_PATHS[kind];
  if (!ep) throw new AppError('invalid_argument', `不支持的字典类型: ${kind}`);
  const scope = permissionScope(input.accountId);
  const key = cacheKeyOf({ qt: 'dict', kind, scope });
  const row = readCache(rt, key);
  if (row && isFresh(row)) {
    const raw = row.result_json;
    let data: unknown = null;
    try {
      const buf = typeof raw === 'string' ? Buffer.from(raw, 'base64') : Buffer.from(raw as Buffer);
      data = JSON.parse((row.result_encoding === 'gzip' ? gunzipSync(buf) : buf).toString('utf8'));
    } catch { data = null; }
    if (data !== null) {
      touchCache(rt, key);
      return { kind, data, source: 'cache', cachedAt: row.fetched_at };
    }
  }
  const pool = poolOf(rt);
  const account = pool.resolveReadAccount(input.accountId);
  const data = await pool.runRead(account.accountId, (ctx) => rt.upstream.call({ accountId: ctx.accountId, tokens: ctx.tokens, logger: rt.logger }, {
    method: ep.method, path: ep.path, query: ep.query
  }));
  const gz = gzipSync(Buffer.from(JSON.stringify(data ?? null), 'utf8'));
  const ttlMs = Math.max(60, rt.config.customs.dictTtlSeconds) * 1000;
  const now = Date.now();
  rt.store.run(
    `INSERT INTO customs_cache_entries(cache_key,query_type,params_hash,params_json,page_index,page_size,permission_scope,result_json,result_encoding,result_bytes,total_num,upstream_version,fetched_at,expires_at,stale,hit_count,last_used_at)
     VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,0,0,?)
     ON CONFLICT(cache_key) DO UPDATE SET result_json=excluded.result_json, result_bytes=excluded.result_bytes, fetched_at=excluded.fetched_at, expires_at=excluded.expires_at, stale=0`,
    key, 'dict', sha256Hex(JSON.stringify({ kind, scope })), JSON.stringify({ kind, scope }), 1, 1, scope,
    gz, 'gzip', gz.byteLength, 0, null, new Date(now).toISOString(), new Date(now + ttlMs).toISOString(), new Date(now).toISOString()
  );
  return { kind, data, source: 'upstream', cachedAt: null };
}

export interface CustomsCacheStats {
  entries: number;
  bytes: number;
  totalHits: number;
  byType: Record<string, number>;
  expired: number;
  lastFetchedAt: string | null;
}

export function customsCacheStats(rt: Runtime): CustomsCacheStats {
  const row = rt.store.get<{ c: number; b: number; h: number }>('SELECT COUNT(*) AS c, COALESCE(SUM(result_bytes),0) AS b, COALESCE(SUM(hit_count),0) AS h FROM customs_cache_entries');
  const byType: Record<string, number> = {};
  for (const r of rt.store.all<{ query_type: string; c: number }>('SELECT query_type, COUNT(*) AS c FROM customs_cache_entries GROUP BY query_type')) byType[r.query_type] = Number(r.c);
  const expired = rt.store.get<{ c: number }>('SELECT COUNT(*) AS c FROM customs_cache_entries WHERE expires_at < ?', nowIso());
  const last = rt.store.get<{ f: string }>('SELECT MAX(fetched_at) AS f FROM customs_cache_entries');
  return { entries: Number(row?.c ?? 0), bytes: Number(row?.b ?? 0), totalHits: Number(row?.h ?? 0), byType, expired: Number(expired?.c ?? 0), lastFetchedAt: last?.f ?? null };
}

export function customsCachePurge(rt: Runtime, input: { queryType?: string; company?: string; before?: string }): { deleted: number } {
  const clauses: string[] = [];
  const params: unknown[] = [];
  if (input.queryType) { clauses.push('query_type=?'); params.push(input.queryType); }
  if (input.company) { clauses.push('params_json LIKE ?'); params.push(`%${normalizedCompany(input.company)}%`); }
  if (input.before) { clauses.push('fetched_at < ?'); params.push(input.before); }
  const where = clauses.length ? ` WHERE ${clauses.join(' AND ')}` : '';
  const r = rt.store.run(`DELETE FROM customs_cache_entries${where}`, ...params);
  return { deleted: Number(r.changes) };
}
