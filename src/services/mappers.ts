import { AppError } from '../core/errors.js';
import type { Runtime } from '../services/runtime.js';

/** 上游原始客户记录 → 平台稳定命名。 */
export interface CustomerView {
  customerId: string;
  accountId: string | null;
  cId: number | null;
  custName: string;
  custShortName: string;
  billCode: string;
  ownerCtId: number | null;
  ownerDeptKey: number | null;
  seasFlag: number;
  custLevel: number | null;
  custSource: number | null;
  custState: number | null;
  countryId: number | null;
  tel: string;
  mobile: string;
  web: string;
  creditCode: string;
  sourceType: number | null;
  createDate: string;
  modifyDate: string;
  willInSeaDate: string | null;
  lastTrackInfo: string;
  contName: string;
  contactNum: number | null;
  location: string;
  remarks: string;
  raw?: Record<string, unknown>;
}

export function toNumberOrNull(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

export function toStr(v: unknown): string {
  return v === null || v === undefined ? '' : String(v);
}

export function mapCustomer(raw: Record<string, unknown>, accountId: string | null): CustomerView {
  const conv = (raw._convert ?? {}) as Record<string, unknown>;
  return {
    customerId: toStr(raw.key_id ?? raw.main_id ?? raw.customerId ?? conv.key_id),
    accountId,
    cId: toNumberOrNull(raw.cId ?? raw.c_id ?? conv.cId ?? conv.c_id),
    custName: toStr(raw.custName ?? conv.custName),
    custShortName: toStr(raw.custShortName ?? conv.custShortName),
    billCode: toStr(raw.billCode ?? conv.billCode),
    ownerCtId: toNumberOrNull(raw.ownerCtId ?? conv.ownerCtId),
    ownerDeptKey: toNumberOrNull(raw.ownerDeptKey ?? conv.ownerDeptKey),
    seasFlag: toNumberOrNull(raw.seasFlag ?? conv.seasFlag) ?? 0,
    custLevel: toNumberOrNull(raw.custLevel ?? conv.custLevel),
    custSource: toNumberOrNull(raw.custSource ?? conv.custSource),
    custState: toNumberOrNull(raw.custState ?? conv.custState),
    countryId: toNumberOrNull(raw.countryId ?? conv.countryId),
    tel: toStr(raw.tel ?? conv.tel),
    mobile: toStr(raw.mobile ?? conv.mobile),
    web: toStr(raw.web ?? conv.web),
    creditCode: toStr(raw.creditCodeEx ?? conv.creditCodeEx),
    sourceType: toNumberOrNull(raw.sourceType ?? conv.sourceType),
    createDate: toStr(raw.createDate ?? conv.createDate),
    modifyDate: toStr(raw.modifyDate ?? conv.modifyDate),
    willInSeaDate: toStr(raw.willInSeaDate ?? conv.willInSeaDate) || null,
    lastTrackInfo: toStr(raw.lastTrackInfo ?? conv.lastTrackInfo),
    contName: toStr(raw.contName ?? conv.contName),
    contactNum: toNumberOrNull(raw.contactNum ?? conv.contactNum),
    location: toStr(raw.location ?? conv.location),
    remarks: toStr(raw.remarks ?? conv.remarks),
    raw
  };
}

export interface ContactView {
  contactId: string;
  customerId: string;
  billCode: string;
  contName: string;
  mobile: string;
  email: string;
  position: string;
  isPrimary: boolean;
  decisionMaker: boolean;
  lastContactTime: string;
  ownerCtId: number | null;
  raw?: Record<string, unknown>;
}

export function mapContact(raw: Record<string, unknown>): ContactView {
  const conv = (raw._convert ?? {}) as Record<string, unknown>;
  const mcc = (raw.mobileCountryCode ?? conv.mobileCountryCode ?? []) as Array<Record<string, unknown>>;
  return {
    contactId: toStr(raw.key_id ?? raw.main_id ?? conv.key_id),
    customerId: toStr(raw.custId ?? conv.custId),
    billCode: toStr(raw.billCode ?? conv.billCode),
    contName: toStr(raw.contName ?? raw.nickName ?? conv.contName),
    mobile: toStr(raw.mobile ?? conv.mobile ?? mcc[0]?.number),
    email: toStr(raw.mailAddress ?? conv.mailAddress),
    position: toStr(raw.jobs ?? conv.jobs ?? raw.position),
    isPrimary: toNumberOrNull(raw.primaryContact ?? conv.primaryContact) === 1,
    decisionMaker: toNumberOrNull(raw.decisionMaker ?? conv.decisionMaker) === 1,
    lastContactTime: toStr(raw.lastContactTime ?? conv.lastContactTime),
    ownerCtId: toNumberOrNull(raw.ownerCtId ?? conv.ownerCtId),
    raw
  };
}

export interface FollowupView {
  followupId: string;
  customerId: string;
  customerName: string;
  billCode: string;
  trackContent: string;
  trackDate: string;
  nextTrackDate: string;
  trackMode: string;
  createType: number | null;
  contactName: string;
  ownerCtId: number | null;
  raw?: Record<string, unknown>;
}

export function mapFollowup(raw: Record<string, unknown>): FollowupView {
  const conv = (raw._convert ?? {}) as Record<string, unknown>;
  return {
    followupId: toStr(raw.key_id ?? raw.main_id ?? conv.key_id),
    customerId: toStr(raw.custId ?? conv.custId),
    customerName: toStr(raw.custName ?? conv.custName),
    billCode: toStr(raw.billCode ?? conv.billCode),
    trackContent: toStr(raw.trackContent ?? conv.trackContent),
    trackDate: toStr(raw.trackDate ?? conv.trackDate),
    nextTrackDate: toStr(raw.nextTrackDate ?? conv.nextTrackDate),
    trackMode: toStr(raw.trackMode ?? conv.trackMode),
    createType: toNumberOrNull(raw.createType ?? conv.createType),
    contactName: toStr(raw.contName ?? conv.contName),
    ownerCtId: toNumberOrNull(raw.ownerCtId ?? conv.ownerCtId),
    raw
  };
}

export interface PageResult<T> {
  list: T[];
  totalNum: number;
  page: number;
  pageSize: number;
  from: number;
  source?: 'upstream' | 'cache';
  cachedAt?: string;
  expiresAt?: string;
  stale?: boolean;
}

export function paging(page: unknown, pageSize: unknown): { from: number; size: number; page: number; pageSize: number } {
  const p = Math.max(1, Number(page ?? 1) || 1);
  const s = Math.min(200, Math.max(1, Number(pageSize ?? 20) || 20));
  return { from: (p - 1) * s, size: s, page: p, pageSize: s };
}

export function assertCompanyOnly(queryType: string | undefined): 'company' {
  const t = queryType ?? 'company';
  if (t !== 'company') {
    throw new AppError('invalid_argument', `MVP 仅支持按公司查询（company）；不支持 ${t}`);
  }
  return 'company';
}
