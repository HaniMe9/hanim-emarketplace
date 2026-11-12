/**
 * The Express application.
 *
 * `createApp` builds the app without binding a port, which is what makes the
 * whole surface testable: a test can start it on an ephemeral port, or drive it
 * in-process, without the module-level `listen` that the previous bootstrap had.
 *
 * Middleware order is deliberate and load-bearing:
 *
 *   1. request id + metrics timing   — wraps everything, so even a rejected
 *                                      request is counted and correlatable
 *   2. security headers              — set before anything can respond
 *   3. CORS + body parsing           — reads `Origin`, needs the body for webhooks
 *   4. raw body capture              — must see the exact bytes for signatures
 *   5. session + same-origin         — every route below can trust `req.user`
 *   6. operational endpoints         — unauthenticated, but non-revealing
 *   7. role-gated routers            — closed at the edge, not in handlers
 *   8. public routes                 — the marketplace itself
 *   9. 404 then error handler        — so every failure has a JSON shape
 */

import express from 'express';
import type { Express, NextFunction, Request, Response } from 'express';
import cors from 'cors';
import { randomUUID } from 'node:crypto';
import type { Config } from './config.ts';
import type { Db } from './store.ts';
import type { Persistence } from './persistence.ts';
import type { Logger } from './lib/logger.ts';
import { Metrics } from './lib/metrics.ts';
import { isAppError } from './lib/errors.ts';
import { ledgerBalances } from './lib/money.ts';
import { requireRole, sessionMiddleware, SessionStore } from './lib/auth.ts';
import { OtpStore } from './lib/otp.ts';
import { mediaRouter } from './media.ts';
import { allowedOrigins, ipOf, rateLimit, requireSameOrigin, securityHeaders } from './lib/http.ts';
import { publicRoutes } from './routes/public.ts';
import { sellerRoutes } from './routes/seller.ts';
import { b2bRouter } from './routes/b2b.ts';
import { agentRouter } from './routes/agent.ts';
import { adminRoutes } from './routes/admin.ts';
import { webhookRoutes } from './routes/webhooks.ts';
import { createPaymentProvider } from './integrations/payments.ts';
import { createShipmentProvider, createSmsProvider } from './integrations/shipping.ts';
import type { PaymentProvider, ShipmentProvider, SmsProvider } from './integrations/types.ts';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Correlates a log line, a metric and an error report for one request. */
      id?: string;
      /** Exact bytes received, needed for webhook signature verification. */
      rawBody?: Buffer;
    }
  }
}

export interface AppDeps {
  config: Config;
  db: Db;
  persistence: Persistence;
  sessions: SessionStore;
  otps: OtpStore;
  log: Logger;
  metrics: Metrics;
  /**
   * Queue a persistence write after a state change.
   *
   * Routers are left alone deliberately: persistence is tracked at the response
   * layer (see `markDirtyOnMutation`) rather than threaded through every handler,
   * so a new route cannot forget to persist by omitting one argument.
   */
  onMutate?: () => void;
}

export interface BuiltApp {
  app: Express;
  sessions: SessionStore;
  otps: OtpStore;
  metrics: Metrics;
  payments: PaymentProvider;
  shipping: ShipmentProvider;
  sms: SmsProvider;
}

export function createApp(deps: AppDeps): BuiltApp {
  const { config: cfg, db, persistence, sessions, otps, log, metrics } = deps;
  const app = express();

  const payments = createPaymentProvider(cfg.providers.payments, metrics, log);
  const shipping = createShipmentProvider(cfg.providers.shipping, metrics, log);
  const sms = createSmsProvider(cfg.providers.sms, metrics, log);

  /* ------------------------- 1. request id + metrics ---------------------- */

  app.use((req, res, next) => {
    req.id = req.header('x-request-id') ?? randomUUID();
    res.setHeader('x-request-id', req.id);
    const started = performance.now();
    res.on('finish', () => {
      // Duration and count are recorded once the response is on the wire, so a
      // series only exists for requests that actually completed.
      const seconds = (performance.now() - started) / 1000;
      metrics.observe('http_request_duration_seconds', seconds, { method: req.method, route: routeLabel(req) });
      metrics.increment('http_requests_total', { method: req.method, route: routeLabel(req), status: String(res.statusCode) });
      if (res.statusCode >= 400) {
        metrics.increment('http_errors_total', { route: routeLabel(req), status: String(res.statusCode) });
      }
    });
    next();
  });

  /* ---------------------------- 2. security ------------------------------ */

  if (cfg.trustProxyHops > 0) app.set('trust proxy', cfg.trustProxyHops);
  app.use(securityHeaders(cfg.isProduction));

  /* ---------------------- 3. CORS and body parsing ----------------------- */

  /**
   * Persistence is tracked here rather than inside each handler.
   *
   * Any non-GET that comes back 2xx or 4xx is treated as having changed state
   * and schedules a snapshot. Handlers mutate `db` directly in dozens of places,
   * and asking every one of them to remember to call `onMutate` is how data ends
   * up lost. A 5xx deliberately does *not* mark dirty: the process is about to
   * report a failure and the in-memory state may be half-written, so snapshotting
   * it would persist the corruption instead of the last good state.
   */
  const markDirtyOnMutation = (req: Request, res: Response, next: NextFunction) => {
    res.on('finish', () => {
      if (req.method === 'GET' || req.method === 'HEAD' || req.method === 'OPTIONS') return;
      if (res.statusCode >= 500) return;
      deps.onMutate?.();
    });
    next();
  };
  app.use(markDirtyOnMutation);

  const origin = allowedOrigins(cfg);
  app.use(cors({ origin, credentials: true, maxAge: 600 }));

  // The raw bytes are captured before JSON parsing so a webhook signature can be
  // checked against exactly what was signed, not against a re-serialised object.
  app.use(
    express.json({
      limit: cfg.bodyLimit,
      verify: (req, _res, buf) => {
        (req as Request).rawBody = Buffer.from(buf);
      },
    }),
  );

  /* ---------------------- 5. session + same-origin ----------------------- */

  app.use('/api', sessionMiddleware(db, sessions, cfg));
  app.use('/api', requireSameOrigin(cfg));

  /* ---------------------- 6. operational endpoints ----------------------- */

  /**
   * Liveness. Deliberately trivial: it answers "is this process running?", which
   * is what a restart policy needs. Anything heavier risks a restart loop when
   * the problem is a slow dependency rather than a dead process.
   */
  app.get('/api/health/live', (_req, res) => {
    res.json({ ok: true, uptime: process.uptime() });
  });

  /**
   * Readiness. Answers "should this instance receive traffic?", so it checks the
   * things that make serving impossible: the ledger balancing and the store
   * being writable. It returns 503 while degraded, which is what keeps traffic
   * off a broken instance.
   */
  app.get('/api/health/ready', async (_req, res) => {
    const balanced = ledgerBalances(db.ledger);
    let writable = true;
    let writeError: string | null = null;
    try {
      await persistence.flush();
    } catch (e) {
      writable = false;
      writeError = e instanceof Error ? e.message : String(e);
    }
    const ok = balanced && writable;
    res.status(ok ? 200 : 503).json({
      ok,
      checks: {
        ledgerBalanced: balanced,
        persistence: { writable, error: writeError, ...persistence.stats() },
      },
      uptime: process.uptime(),
    });
  });

  /** Full diagnostics. Never leaks counts of other tenants' data or any secret. */
  app.get('/api/health', (_req, res) => {
    res.json({
      ok: true,
      version: db.version,
      env: cfg.env,
      uptime: process.uptime(),
      ledgerBalanced: ledgerBalances(db.ledger),
      sessions: sessions.size,
      counts: {
        products: db.products.length,
        offers: db.offers.length,
        orders: db.orders.length,
        orgs: db.orgs.length,
        users: db.users.length,
        ledgerEntries: db.ledger.length,
        agentRoutes: db.agentRoutes.length,
        settlements: db.settlements.length,
      },
      persistence: persistence.stats(),
      providers: {
        payments: { provider: payments.name, mode: payments.mode },
        shipping: { provider: shipping.name, mode: shipping.mode },
        sms: { provider: sms.name, mode: sms.mode },
      },
      serverTime: new Date().toISOString(),
    });
  });

  /** Prometheus scrape target. */
  app.get('/metrics', (_req, res) => {
    metrics.setGauge('ledger_balanced', ledgerBalances(db.ledger) ? 1 : 0);
    metrics.setGauge('session_count', sessions.size);
    metrics.setGauge('persistence_pending', persistence.stats().pending ? 1 : 0);
    res.setHeader('content-type', 'text/plain; version=0.0.4; charset=utf-8');
    res.send(metrics.render());
  });

  app.use('/api', mediaRouter());

  /* -------------------------- 7. role routers ---------------------------- */

  app.use('/api/seller', requireRole('seller'), sellerRoutes(db));
  app.use('/api/b2b', requireRole('business_buyer'), b2bRouter(db));
  app.use('/api/agent', requireRole('agent'), agentRouter(db));
  app.use('/api/admin', requireRole('admin'), adminRoutes(db, sessions));

  /* ---------------------------- 8. webhooks ------------------------------ */
  // Mounted before the public router so a provider callback never needs a
  // session cookie, and signature verification is the only way in.
  app.use('/api/webhooks', webhookRoutes(db, { payments, metrics, log, onMutate: deps.onMutate ?? (() => {}) }));

  /* ---------------------------- 9. public -------------------------------- */

  const loginLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 10,
    // Count wrong passwords, not sign-ins. The brute force it defends against is
    // made of failed attempts; counting successes would lock out a real customer
    // who signs in from a second device or after a session expires.
    countFailuresOnly: true,
    message: 'Too many sign-in attempts for this account. Wait a few minutes and try again.',
    key: (req) => {
      const email = (req as Request).body?.email;
      return typeof email === 'string' && email ? `email:${email.trim().toLowerCase()}` : `ip:${ipOf(req)}`;
    },
    onLimit: () => metrics.increment('auth_login_total', { outcome: 'rate_limited' }),
  });
  const otpLimiter = rateLimit({
    windowMs: 10 * 60 * 1000,
    max: 20,
    // Same reasoning as the login limiter: a code the customer got right must
    // not consume their budget for the next one.
    countFailuresOnly: true,
    key: (req) => (req as Request).user?.id ?? `ip:${ipOf(req)}`,
  });

  app.use(
    '/api',
    publicRoutes(db, sessions, {
      otps,
      loginLimiter,
      otpLimiter,
      payments,
      metrics,
      log,
    }),
  );

  /* ------------------------- 10. not found + errors ----------------------- */

  app.use((_req, res) => {
    res.status(404).json({ error: 'not_found', message: 'No such endpoint.' });
  });

  /**
   * Every failure leaves as the same JSON envelope, and every failure is logged
   * with its request id so a user-reported failure can be found without guessing
   * from a timestamp.
   */
  app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
    if (res.headersSent) return;

    const requestId = req.id;
    if (isAppError(err)) {
      if (err.status >= 500) {
        log.error('Request failed', { requestId, code: err.code, status: err.status, path: req.path, method: req.method, error: err });
      } else {
        log.debug('Request rejected', { requestId, code: err.code, status: err.status, path: req.path });
      }
      if (err.retryable && err.status === 429) {
        const retryAfter = (err.detail as { retryAfterSeconds?: number } | undefined)?.retryAfterSeconds;
        if (typeof retryAfter === 'number') res.setHeader('retry-after', String(retryAfter));
      }
      res.status(err.status).json({ error: err.code, message: err.message, detail: err.detail, requestId });
      return;
    }

    // An unrecognised error is a bug. The caller gets a generic message; the
    // detail stays in the log where it belongs.
    log.error('Unhandled error', {
      requestId,
      path: req.path,
      method: req.method,
      error: err instanceof Error ? { name: err.name, message: err.message, stack: err.stack } : err,
    });
    res.status(500).json({
      error: 'server_error',
      message: 'Something went wrong on our side. The incident has been logged.',
      requestId,
    });
  });

  return { app, sessions, otps, metrics, payments, shipping, sms };
}

/**
 * The route pattern rather than the concrete path, so `/api/orders/ord_x`
 * produces one metric series instead of one per order. Unmatched paths collapse
 * to `unmatched` so a scanner cannot inflate the series count.
 */
function routeLabel(req: Request): string {
  const path = req.route?.path ? `${req.baseUrl ?? ''}${req.route.path}` : null;
  if (path) return path;
  const matched = req.route === undefined && req.path.includes('/') ? req.path : null;
  if (matched) return normalizePath(matched);
  return 'unmatched';
}

function normalizePath(path: string): string {
  return path
    .split('/')
    .map((seg) => {
      if (!seg) return seg;
      // Identifiers are long and high-cardinality; collapse them to a label.
      if (/^[a-z]{1,4}_[a-z0-9]{6,}$/i.test(seg)) return ':id';
      if (/^\d{4,}$/.test(seg)) return ':id';
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-/i.test(seg)) return ':id';
      if (/^HM-/.test(seg)) return ':code';
      return seg;
    })
    .join('/');
}
