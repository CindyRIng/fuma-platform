#!/usr/bin/env tsx
/**
 * 时区/时间工具。平台统一使用带偏移的 ISO 8601。
 */
export function nowIso(): string {
  return new Date().toISOString();
}

export function nowMs(): number {
  return Date.now();
}

export function toIso(date: Date | number): string {
  return new Date(date).toISOString();
}

/** 加上毫秒后的 ISO 时间 */
export function plusMsIso(ms: number, base: number = Date.now()): string {
  return new Date(base + ms).toISOString();
}

export function plusDaysIso(days: number, base: Date = new Date()): string {
  return new Date(base.getTime() + days * 86_400_000).toISOString();
}

export function isPast(iso: string | null | undefined): boolean {
  if (!iso) return false;
  const t = Date.parse(iso);
  return Number.isFinite(t) && t <= Date.now();
}

export function secondsUntil(iso: string): number {
  const t = Date.parse(iso);
  if (!Number.isFinite(t)) return 0;
  return Math.floor((t - Date.now()) / 1000);
}

/** 孚盟侧时间格式：yyyy-MM-dd HH:mm:ss */
export function fumaDateTime(date: Date = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function readDuration(value: string | number | undefined, fallbackMs: number): number {
  if (value === undefined || value === null || value === '') return fallbackMs;
  if (typeof value === 'number') return value;
  const m = /^(\d+(?:\.\d+)?)\s*(ms|s|m|h|d)?$/i.exec(value.trim());
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = (m[2] ?? 'ms').toLowerCase();
  const mul = unit === 'd' ? 86_400_000 : unit === 'h' ? 3_600_000 : unit === 'm' ? 60_000 : unit === 's' ? 1_000 : 1;
  return Math.round(n * mul);
}
