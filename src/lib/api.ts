import { t } from './i18n/index.ts';

export type Minor = number;

type Query = Record<string, string | number | boolean | undefined | null>;

export function qs(params: Query = {}): string {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(params)) {
    if (v === undefined || v === null || v === '') continue;
    sp.set(k, String(v));
  }
  const s = sp.toString();
  return s ? `?${s}` : '';
}

export class ApiError extends Error {
  status: number;
  code: string;
  body: Record<string, unknown>;
  constructor(status: number, body: Record<string, unknown>) {
    super(typeof body.message === 'string' ? body.message : t('Request failed ({status})', { status }));
    this.status = status;
    this.code = typeof body.error === 'string' ? body.error : 'error';
    this.body = body;
  }
}

type UnauthorizedHandler = () => void;
let onUnauthorized: UnauthorizedHandler | null = null;

/**
 * Registered once by the session provider. Fires when the API says the session
 * is gone — expired, revoked, or signed out in another tab — so the app can
 * drop straight back to the sign-in screen instead of rendering a page of
 * broken panels.
 */
export function setUnauthorizedHandler(fn: UnauthorizedHandler | null): void {
  onUnauthorized = fn;
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      ...init,
      // The session lives in an httpOnly cookie, so it has to ride along.
      credentials: 'same-origin',
      headers: { 'Content-Type': 'application/json', ...(init.headers ?? {}) },
    });
  } catch {
    throw new ApiError(0, {
      error: 'offline',
      message: t('Could not reach HaniMarket. Check your connection and try again.'),
    });
  }

  const text = await res.text();
  let body: unknown = null;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = { message: text.slice(0, 200) };
    }
  }

  if (!res.ok) {
    if (res.status === 401) onUnauthorized?.();
    throw new ApiError(res.status, (body ?? {}) as Record<string, unknown>);
  }
  return body as T;
}

export const api = {
  get: <T>(path: string) => request<T>(path),
  post: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'POST', body: JSON.stringify(data ?? {}) }),
  patch: <T>(path: string, data?: unknown) =>
    request<T>(path, { method: 'PATCH', body: JSON.stringify(data ?? {}) }),
  del: <T>(path: string) => request<T>(path, { method: 'DELETE' }),
};
