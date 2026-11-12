import { randomUUID } from 'node:crypto';

/** Monotonic-ish sortable id (ULID-flavoured: time prefix + entropy). */
let last = 0;
export function id(prefix: string): string {
  const t = Date.now();
  last = Math.max(last + 1, t);
  const time = last.toString(36).padStart(9, '0');
  const rand = Math.floor(Math.random() * 36 ** 6)
    .toString(36)
    .padStart(6, '0');
  return `${prefix}_${time}${rand}`;
}

export function uuid(): string {
  return randomUUID();
}

let seq = 1000;
export function code(prefix: string): string {
  seq += 1;
  return `${prefix}-${String(seq).padStart(5, '0')}`;
}

/** Deterministic pseudo-random so seeded data is stable across restarts. */
export function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 4294967296;
  };
}

export function pick<T>(r: () => number, xs: readonly T[]): T {
  return xs[Math.floor(r() * xs.length) % xs.length];
}

export function daysAgo(n: number, base = Date.now()): string {
  return new Date(base - n * 86400000).toISOString();
}
export function daysAhead(n: number, base = Date.now()): string {
  return new Date(base + n * 86400000).toISOString();
}
export function minutesAgo(n: number, base = Date.now()): string {
  return new Date(base - n * 60000).toISOString();
}
