import { appendFileSync, mkdirSync } from 'node:fs';
import { dirname } from 'node:path';

export type LogLevel = 'debug' | 'info' | 'warn' | 'error';

const LEVEL_WEIGHT: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

export interface LoggerOptions {
  level?: LogLevel;
  file?: string;
  redact?: boolean;
  console?: boolean;
  bindings?: Record<string, unknown>;
}

const SENSITIVE_KEYS = /token|cookie|secret|password|authorization|individualAccessToken|accessToken/i;

export function redactValue(value: unknown, depth = 0): unknown {
  if (depth > 6) return '[depth]';
  if (value === null || value === undefined) return value;
  if (typeof value === 'string') {
    if (value.length > 40 && /^[A-Za-z0-9+/=_-]+$/.test(value)) return `${value.slice(0, 4)}***${value.slice(-2)}`;
    return value.length > 4000 ? `${value.slice(0, 4000)}…[truncated]` : value;
  }
  if (Array.isArray(value)) return value.slice(0, 100).map((v) => redactValue(v, depth + 1));
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SENSITIVE_KEYS.test(k) ? '***' : redactValue(v, depth + 1);
    }
    return out;
  }
  return value;
}

export class Logger {
  private readonly level: LogLevel;
  private readonly file?: string;
  private readonly redact: boolean;
  private readonly consoleOutput: boolean;
  private readonly bindings: Record<string, unknown>;

  constructor(opts: LoggerOptions = {}) {
    this.level = opts.level ?? 'info';
    this.file = opts.file;
    this.redact = opts.redact ?? true;
    this.consoleOutput = opts.console ?? true;
    this.bindings = opts.bindings ?? {};
    if (this.file) {
      try {
        mkdirSync(dirname(this.file), { recursive: true });
      } catch {
        /* ignore */
      }
    }
  }

  child(bindings: Record<string, unknown>): Logger {
    return new Logger({ level: this.level, file: this.file, redact: this.redact, console: this.consoleOutput, bindings: { ...this.bindings, ...bindings } });
  }

  debug(msg: string, extra?: Record<string, unknown>): void { this.write('debug', msg, extra); }
  info(msg: string, extra?: Record<string, unknown>): void { this.write('info', msg, extra); }
  warn(msg: string, extra?: Record<string, unknown>): void { this.write('warn', msg, extra); }
  error(msg: string, extra?: Record<string, unknown>): void { this.write('error', msg, extra); }

  private write(level: LogLevel, msg: string, extra?: Record<string, unknown>): void {
    if (LEVEL_WEIGHT[level] < LEVEL_WEIGHT[this.level]) return;
    const entry: Record<string, unknown> = {
      ts: new Date().toISOString(),
      level,
      msg,
      ...this.bindings,
      ...(extra ?? {})
    };
    if (this.redact) {
      for (const [k, v] of Object.entries(entry)) {
        entry[k] = SENSITIVE_KEYS.test(k) ? '***' : redactValue(v);
      }
    }
    const line = JSON.stringify(entry);
    if (this.file) {
      try { appendFileSync(this.file, line + '\n'); } catch { /* ignore */ }
    }
    if (level === 'error') console.error(line);
    else console.log(line);
  }
}

export function createLogger(opts: LoggerOptions = {}): Logger {
  return new Logger(opts);
}
