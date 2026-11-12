/**
 * HTTP edge concerns: client identity, security headers, CORS, origin checks
 * and rate limiting.
 *
 * Everything here reads from the validated `Config` rather than from
 * `process.env`, so there is one definition of what this deployment believes and
 * the development defaults cannot leak into production.
 */

import type { NextFunction, Request, Response } from 'express';
import type { Config } from '../config.ts';

export function ipOf(req: Request): string {
  // `req.ip` already honours the app's `trust proxy` setting. At the default it
  // is the socket address and X-Forwarded-For is ignored; with `trust proxy` on,
  // it is the address the proxy actually observed. Reading the header by hand
  // would trust whatever the client typed, which is precisely how a rate limiter
  // gets walked around. See `HM_TRUST_PROXY` in server/config.ts.
  return (req.ip || req.socket.remoteAddress || 'unknown').trim();
}

/**
 * Conservative security headers, set at the edge because there is no CDN in
 * front of this app. The CSP allows only self-hosted scripts and styles, which
 * is enough for the React bundle and blocks injected inline payloads.
 */
export function securityHeaders(isProduction: boolean) {
  return (_req: Request, res: Response, next: NextFunction) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Permissions-Policy', 'geolocation=(self), camera=(self), microphone=()');
    res.setHeader(
      'Content-Security-Policy',
      [
        "default-src 'self'",
        "script-src 'self'",
        // Vite emits a single stylesheet; inline style is needed for the few
        // element-level width/height bindings React sets.
        "style-src 'self' 'unsafe-inline'",
        "img-src 'self' data:",
        "font-src 'self' data:",
        "connect-src 'self'",
        "form-action 'self'",
        "frame-ancestors 'none'",
        "base-uri 'self'",
        "object-src 'none'",
      ].join('; '),
    );
    if (isProduction) {
      // Only meaningful over TLS, and only safe to send once TLS is guaranteed.
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains; preload');
    }
    next();
  };
}

/**
 * Mirrors the `cors` package's `CustomOrigin` callback shape: the origin is
 * `undefined` when the request carried no `Origin` header.
 */
export type OriginChecker = (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => void;

/**
 * Origins allowed to send credentialed requests: exactly the configured list.
 * In production that list contains only what the operator set, so a forgotten
 * variable cannot leave localhost origins accepted.
 */
export function allowedOrigins(cfg: Config): OriginChecker {
  const allowed = new Set(cfg.allowedOrigins);
  return (origin, callback) => {
    // No Origin header means a non-browser client (curl, a mobile app, a
    // server-to-server call). The cookie protections still apply, and refusing
    // these outright would break legitimate integrations.
    if (!origin) return callback(null, true);
    callback(null, allowed.has(origin));
  };
}

export interface RateLimitOptions {
  windowMs: number;
  max: number;
  /** Identity the limit applies to. Defaults to the client address. */
  key?: (req: Request, body: unknown) => string;
  message?: string;
  onLimit?: () => void;
  /**
   * Only count requests that were *refused*, rather than every request seen.
   *
   * This is what a credential-checking limiter wants. Counting successes means a
   * real customer who signs in from a phone and a laptop, or who re-authenticates
   * after a session expires, burns the same budget as an attacker guessing — and
   * then gets locked out of their own account for the rest of the window.
   * Brute force is made of failures, so only failures are counted.
   *
   * The check still runs on the way in, so the attempt that would exceed the
   * budget is refused before the credential is ever compared.
   */
  countFailuresOnly?: boolean;
}

/** A counter store that several limiters share, so they can be reset together. */
export interface RateLimitStore {
  hits: Map<string, { count: number; resetAt: number }>;
}

export function createRateLimitStore(): RateLimitStore {
  return { hits: new Map() };
}

/**
 * Fixed-window counter.
 *
 * Single-process by design: the point is to make online password guessing
 * impractical, not to be a distributed quota. Behind more than one instance this
 * has to move to a shared store the same way sessions do — and note that
 * `HM_TRUST_PROXY` becoming mandatory in production is what keeps the key
 * meaningful once there is more than one.
 */
export function rateLimit({ windowMs, max, key, message, onLimit, countFailuresOnly = false }: RateLimitOptions, store: RateLimitStore = createRateLimitStore()) {
  return (req: Request, res: Response, next: NextFunction) => {
    const now = Date.now();
    for (const [k, v] of store.hits) if (v.resetAt <= now) store.hits.delete(k);

    const id = key ? key(req, req.body) : ipOf(req);
    const refuse = (entry: { resetAt: number } | undefined) => {
      const retryAfter = Math.ceil(((entry?.resetAt ?? now + windowMs) - now) / 1000);
      res.setHeader('Retry-After', String(retryAfter));
      onLimit?.();
      return res.status(429).json({
        error: 'rate_limited',
        message: message ?? `Too many attempts. Try again in ${Math.ceil(retryAfter / 60)} minute(s).`,
        retryAfterSeconds: retryAfter,
      });
    };

    if (countFailuresOnly) {
      // Refuse on the way in, but only bank the attempt if it was refused. A
      // 401 is a wrong guess; a 200 is a customer signing in, and charging that
      // against the brute-force budget locks out the people the limit protects.
      const entry = store.hits.get(id);
      if (entry && entry.resetAt > now && entry.count >= max) return refuse(entry);
      let banked = false;
      res.on('finish', () => {
        if (banked || res.statusCode < 400) return;
        banked = true;
        const at = Date.now();
        const live = store.hits.get(id);
        if (live && live.resetAt > at) live.count += 1;
        else store.hits.set(id, { count: 1, resetAt: at + windowMs });
      });
      return next();
    }

    const entry = store.hits.get(id);
    if (!entry || entry.resetAt <= now) {
      store.hits.set(id, { count: 1, resetAt: now + windowMs });
      return next();
    }
    entry.count += 1;
    if (entry.count > max) return refuse(entry);
    next();
  };
}

/**
 * Reject cross-site state-changing requests. `sameSite=lax` on the session cookie
 * already blocks a cross-site form POST; this covers the fetch/XHR case and any
 * future cookie relaxation.
 */
export function requireSameOrigin(cfg: Config) {
  const allowed = allowedOrigins(cfg);
  return (req: Request, res: Response, next: NextFunction) => {
    if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return next();
    const origin = req.headers.origin;
    // A request with no Origin at all is a non-browser client; the cookie
    // protections still cover it.
    if (!origin) return next();
    allowed(origin, (err, ok) => {
      if (err || !ok) {
        return res.status(403).json({ error: 'bad_origin', message: 'Cross-origin request refused.' });
      }
      next();
    });
  };
}
