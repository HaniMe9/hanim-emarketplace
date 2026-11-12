/**
 * Structured logging.
 *
 * Production logs are JSON, one object per line: a log aggregator can index
 * `level`, `msg`, `durationMs` and any extra fields without a regex. Development
 * keeps the human-readable form, because that is who is reading it there.
 *
 * Nothing logs a secret. `redact` is applied to every extra field by default, so
 * a caller passing a credential-shaped object by accident still cannot write it
 * to disk.
 */

import type { LogLevel } from '../config.ts';

const ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };

/** Keys whose values never appear in logs, at any nesting depth. */
const SECRET_KEYS = new Set([
  'password',
  'appsecret',
  'app_secret',
  'secret',
  'token',
  'accesstoken',
  'access_token',
  'refreshtoken',
  'refresh_token',
  'apikey',
  'api_key',
  'authorization',
  'cookie',
  'otp',
  'pin',
  'accountnumber',
  'account_number',
  'hash',
  'hm_session',
]);

const redact = (value: unknown, depth = 0): unknown => {
  if (depth > 6) return '[deep]';
  if (value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.slice(0, 50).map((v) => redact(v, depth + 1));
  if (value instanceof Error) return { name: value.name, message: value.message, stack: value.stack };
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
      out[k] = SECRET_KEYS.has(k.toLowerCase()) ? '[redacted]' : redact(v, depth + 1);
    }
    return out;
  }
  return value;
};

export interface Logger {
  debug(msg: string, meta?: Record<string, unknown>): void;
  info(msg: string, meta?: Record<string, unknown>): void;
  warn(msg: string, meta?: Record<string, unknown>): void;
  error(msg: string, meta?: Record<string, unknown>): void;
  /** A logger that stamps every line with additional fields. */
  child(bindings: Record<string, unknown>): Logger;
}

export interface LoggerOptions {
  level: LogLevel;
  json: boolean;
  service?: string;
  /** Injected for tests. */
  sink?: (line: string) => void;
  /** Injected for tests. */
  now?: () => Date;
}

export function createLogger(opts: LoggerOptions): Logger {
  const threshold = ORDER[opts.level];
  const service = opts.service ?? 'hanimarket-api';
  const sink = opts.sink ?? ((line: string) => process.stdout.write(line + '\n'));
  const now = opts.now ?? (() => new Date());

  const emit = (level: LogLevel, bindings: Record<string, unknown>, msg: string, meta?: Record<string, unknown>) => {
    if (ORDER[level] < threshold) return;
    const at = now().toISOString();
    const fields = { ...bindings, ...(meta ?? {}) };
    if (opts.json) {
      sink(JSON.stringify({ level, time: at, service, msg, ...(redact(fields) as Record<string, unknown>) }));
      return;
    }
    const extra = Object.entries(redact(fields) as Record<string, unknown>)
      .map(([k, v]) => `${k}=${typeof v === 'string' ? v : JSON.stringify(v)}`)
      .join(' ');
    sink(`${at} ${level.toUpperCase().padEnd(5)} ${msg}${extra ? ` ${extra}` : ''}`);
  };

  const make = (bindings: Record<string, unknown>): Logger => ({
    debug: (msg, meta) => emit('debug', bindings, msg, meta),
    info: (msg, meta) => emit('info', bindings, msg, meta),
    warn: (msg, meta) => emit('warn', bindings, msg, meta),
    error: (msg, meta) => emit('error', bindings, msg, meta),
    child: (extra) => make({ ...bindings, ...extra }),
  });

  return make({});
}

/** A logger that discards everything, for tests that assert on behaviour only. */
export const nullLogger: Logger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  child: () => nullLogger,
};
