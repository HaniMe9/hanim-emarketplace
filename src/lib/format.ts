import type { Minor } from './api.ts';
import { activeLang, localeFor, t, tr } from './i18n/index.ts';

/**
 * Locale follows the active language so Ethiopic digits and Amharic month
 * names appear when the UI is in Amharic.
 */
function etLocale(): string {
  return localeFor(activeLang());
}

/** Santim → a real Ethiopian birr amount, rounded to 2dp. Never a float in the wire. */
export function money(minor: Minor, opts: { decimals?: boolean } = {}): string {
  const decimals = opts.decimals ?? true;
  return (minor / 100).toLocaleString(etLocale(), {
    minimumFractionDigits: decimals ? 2 : 0,
    maximumFractionDigits: decimals ? 2 : 0,
  });
}

export function birr(minor: Minor, opts?: { decimals?: boolean }): string {
  return `ETB ${money(minor, opts)}`;
}

export function pct(value: number, digits = 1): string {
  return `${value.toFixed(digits)}%`;
}

export function compact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(1)}M`;
  if (Math.abs(value) >= 10_000) return `${(value / 1000).toFixed(1)}k`;
  return value.toLocaleString(etLocale());
}

export function num(value: number | undefined, digits = 0): string {
  return (value ?? 0).toLocaleString(etLocale(), { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

/** Compact money for chart axes and stat tiles. */
export function moneyShort(minor: Minor): string {
  const etb = minor / 100;
  if (Math.abs(etb) >= 1_000_000) return `ETB ${(etb / 1_000_000).toFixed(1)}M`;
  if (Math.abs(etb) >= 10_000) return `ETB ${(etb / 1000).toFixed(0)}k`;
  return `ETB ${etb.toFixed(0)}`;
}

export function dateTime(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleString(etLocale(), { dateStyle: 'medium', timeStyle: 'short' });
}

export function dateOnly(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(etLocale(), { dateStyle: 'medium' });
}

export function timeOnly(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleTimeString(etLocale(), { timeStyle: 'short' });
}

export function dayLabel(iso?: string): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString(etLocale(), { day: '2-digit', month: 'short' });
}

export function ago(iso?: string): string {
  if (!iso) return '—';
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  const abs = Math.abs(mins);
  if (abs < 1) return t('just now');
  if (abs < 60) return t('{n}m ago', { n: mins });
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 24) return t('{n}h ago', { n: hrs });
  const days = Math.round(hrs / 24);
  if (Math.abs(days) < 30) return t('{n}d ago', { n: days });
  return dateOnly(iso);
}

export function until(iso?: string): string {
  if (!iso) return '—';
  const diff = new Date(iso).getTime() - Date.now();
  const mins = Math.round(diff / 60000);
  if (Math.abs(mins) < 60) return t('{n}m', { n: mins });
  const hrs = Math.round(mins / 60);
  if (Math.abs(hrs) < 48) return t('{n}h', { n: hrs });
  return t('{n}d', { n: Math.round(hrs / 24) });
}

/** Latin digits and readable English for an amount that must be spoken. */
export function etbAmount(minor: Minor): string {
  const etb = minor / 100;
  const whole = Math.trunc(etb);
  const cents = Math.round((etb - whole) * 100);
  const wholePart = birr(whole, { decimals: false });
  return cents ? t('{amount} and {cents} santim', { amount: wholePart, cents }) : wholePart;
}

export const STATUS_TONE: Record<string, 'ok' | 'warn' | 'bad' | 'info' | 'muted' | 'brand' | 'gold' | 'violet'> = {
  // order
  placed: 'info', confirmed: 'info', packed: 'info', shipped: 'info', out_for_delivery: 'brand',
  delivered: 'ok', completed: 'ok', cancelled: 'muted', refunded: 'warn', returned: 'warn',
  // listing
  live: 'ok', pending_review: 'warn', rejected: 'bad', draft: 'muted', archived: 'muted', paused: 'warn',
  // finance
  accruing: 'muted', ready: 'info', approved: 'brand', paying: 'gold', paid: 'ok',
  blocked: 'bad', on_hold: 'warn',
  // dispute
  open: 'bad', seller_response: 'warn', mediation: 'violet', resolved_buyer: 'ok', resolved_seller: 'ok', closed: 'muted',
  // verification
  queued: 'muted', in_review: 'info', needs_info: 'warn', suspended: 'bad',
  // delivery
  planned: 'muted', in_progress: 'brand', pending: 'muted', arrived: 'gold', failed: 'bad',
  assigned: 'info', picked_up: 'info',
  // generic
  published: 'ok', removed: 'bad', flagged: 'warn',
  clean: 'ok', exceptions: 'warn',
};

/**
 * Status pill text. Known statuses come from the dictionary; an unknown one
 * falls back to a readable form of the raw value rather than leaking `snake_case`.
 */
export function statusLabel(status: string): string {
  return tr(activeLang(), status, {}) === status
    ? titleCase(status)
    : tr(activeLang(), status);
}

export function initials(name: string): string {
  return name
    .split(/\s+/)
    .slice(0, 2)
    .map((p) => p[0]?.toUpperCase() ?? '')
    .join('');
}

/**
 * Humanises an enum-ish token: `pending_review` → `Pending Review`. Deliberately
 * not routed through the dictionary, because most call sites pass an arbitrary
 * server value whose Amharic equivalent is not known here.
 */
export function titleCase(value: string): string {
  return value.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

/**
 * Label for an enum token whose Amharic equivalent is in the dictionary
 * (`live` → `ነቃ`). Tokens that are not translated fall back to `titleCase` so an
 * unknown server value still reads as prose rather than leaking `snake_case`.
 */
export function enumLabel(value: string): string {
  const translated = tr(activeLang(), value);
  return translated === value ? titleCase(value) : translated;
}
