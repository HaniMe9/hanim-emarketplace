/**
 * Process bootstrap.
 *
 * What the app *is* — middleware order, routers, the error envelope — lives in
 * `app.ts`. This file only does the things a real process must do that an
 * in-process test should not: read and validate the environment, open the store,
 * bind a port, and shut down without losing a write.
 *
 * That split is the whole reason `createApp` exists. When the two were one file,
 * the wiring lived in the same module as the module-level `listen`, so the
 * middleware could only be exercised by starting a server — and the helpers it
 * wires (`securityHeaders`, `allowedOrigins`, `requireSameOrigin`) had already
 * moved to reading a validated `Config`, so the bootstrap drifted out of step
 * with them. The process then threw during startup, before `listen`, and every
 * request through the Vite proxy came back as a 500.
 */

import { config, ConfigError } from './config.ts';
import { pathToFileURL } from 'node:url';
import type { Server } from 'node:http';
import { readFileSync, writeFileSync, rmSync } from 'node:fs';
import { resolve } from 'node:path';
import { execFileSync } from 'node:child_process';
import { createApp } from './app.ts';
import { buildDatabase } from './data/index.ts';
import { createPersistence, restore } from './persistence.ts';
import { createLogger } from './lib/logger.ts';
import { Metrics } from './lib/metrics.ts';
import { SessionStore } from './lib/auth.ts';
import { OtpStore } from './lib/otp.ts';
import { ledgerBalances } from './lib/money.ts';

export interface Runtime {
  app: ReturnType<typeof createApp>['app'];
  config: ReturnType<typeof config>;
  log: ReturnType<typeof createLogger>;
  sessions: ReturnType<typeof createApp>['sessions'];
  otps: ReturnType<typeof createApp>['otps'];
  metrics: Metrics;
  persistence: ReturnType<typeof createPersistence>;
  db: ReturnType<typeof buildDatabase>;
  restored: boolean;
  savedAt: string | null;
}

/**
 * Build the runtime without binding a port.
 *
 * Exported so a test — or a tool — can get a fully wired app, with a real store
 * and a real config, without occupying port 4000.
 */
export function createRuntime(): Runtime {
  const cfg = config();

  const log = createLogger({ level: cfg.logLevel, json: cfg.isProduction });
  const metrics = new Metrics();
  // The persistence adapter wants a `(level, message, meta)` sink; the logger
  // wants a message first. Adapting here keeps the adapter free of a logging
  // dependency and gives one place to change the shape.
  const sink = (level: 'info' | 'warn' | 'error', message: string, meta?: Record<string, unknown>) => log[level](message, meta);

  const persistence = createPersistence({
    mode: cfg.persistence.mode,
    path: cfg.persistence.path,
    flushIntervalMs: cfg.persistence.flushIntervalMs,
    log: sink,
  });

  // `restore` refuses to continue from a snapshot whose ledger does not balance,
  // and refuses to seed an empty store when seeding is switched off. Both are
  // startup failures on purpose: continuing would mean taking orders against
  // figures nobody can trust.
  const { db, restored, savedAt } = restore(buildDatabase, persistence, sink, { seedIfEmpty: cfg.persistence.seedIfEmpty });

  const sessions = new SessionStore(cfg.session.ttlMs);
  // `HM_DEV_OTP=fixed` is the sandbox escape hatch, and the literal the tests and
  // a developer sandbox checkout type in. `config` has already refused to start
  // production with it set, so reaching this line with `fixedCode: true` is
  // always a deliberate choice.
  const otps = new OtpStore(Date.now, {
    fixedCode: cfg.otp.fixedCode ? 'fixed' : undefined,
    ttlMs: cfg.otp.ttlMs,
    maxAttempts: cfg.otp.maxAttempts,
  });

  const built = createApp({
    config: cfg,
    db,
    persistence,
    sessions,
    otps,
    log,
    metrics,
    // Every mutation schedules a snapshot. The app tracks this at the response
    // layer, so a route that forgot to call it is impossible to write.
    onMutate: () => persistence.markDirty(),
  });

  return { app: built.app, config: cfg, log, sessions, otps, metrics, persistence, db, restored, savedAt };
}

/** How long to keep retrying a busy port before giving up on it. */
function resolvePidFile(configured: string): string {
  return resolve(process.cwd(), configured);
}

const PORT_RETRY_WINDOW_MS = 6000;
const PORT_RETRY_DELAY_MS = 250;

/**
 * Binds `port`, tolerating a predecessor that has not finished exiting.
 *
 * `tsx watch` replaces the API process on every save, and on Windows the new
 * process can reach `listen` while the old one still holds the socket. Failing
 * immediately turned that race into a dead API and a wall of proxy errors in
 * the browser, so outside production we wait briefly for the port to clear.
 * Production still fails fast: a busy port there is a real deployment fault.
 */
function listenWithRetry(
  app: Runtime['app'],
  port: number,
  env: string,
  log: ReturnType<typeof createLogger>,
  onListening: (attempt: number) => void,
): Server {
  const retryable = env !== 'production';
  const deadline = Date.now() + PORT_RETRY_WINDOW_MS;
  let attempt = 0;

  const bind = (): Server => {
    const server = app.listen(port, () => onListening(attempt));
    server.on('error', (err) => {
      const code = (err as NodeJS.ErrnoException).code;
      if (code === 'EADDRINUSE' && retryable && Date.now() < deadline) {
        attempt += 1;
        log.warn('Port busy; waiting for the previous instance to exit', {
          port,
          attempt,
          givingUpInMs: Math.max(0, deadline - Date.now()),
        });
        setTimeout(bind, PORT_RETRY_DELAY_MS);
        return;
      }
      if (code === 'EADDRINUSE') {
        log.error(`Port ${port} is already in use — another instance is probably still running`, {
          error: err.message,
        });
        process.exit(1);
      }
      log.error('HTTP server error', { error: err });
    });
    return server;
  };

  return bind();
}


/**
 * Evicts a predecessor dev instance that is squatting on our port.
 *
 * `tsx watch` replaces the API process on every save. On Windows the outgoing
 * child frequently survives its replacement and keeps the listening socket, so
 * the fresh process loses the race and either dies or — worse — leaves the old
 * build answering requests. Quietly serving the previous build is the more
 * dangerous failure, because every test after that save is measuring code that
 * is no longer on disk.
 *
 * So in development each instance records its pid, and a new one evicts the
 * recorded predecessor before binding. The check that the recorded process is
 * actually one of ours keeps this from ever targeting an unrelated program.
 * Production never does this.
 */
function evictStaleInstance(pidFile: string, log: ReturnType<typeof createLogger>): void {
  let pid: number;
  try {
    pid = Number(readFileSync(pidFile, 'utf8').trim());
  } catch {
    return; // No predecessor recorded; nothing to evict.
  }
  if (!Number.isInteger(pid) || pid <= 0 || pid === process.pid) return;

  // Read the recorded process's command line so we can refuse to signal anything
  // that is not running this same entrypoint.
  let line: string;
  try {
    line =
      process.platform === 'win32'
        ? execFileSync('powershell', ['-NoProfile', '-Command', `(Get-CimInstance Win32_Process -Filter "ProcessId=${pid}").CommandLine`], {
            encoding: 'utf8',
            stdio: ['ignore', 'pipe', 'ignore'],
          })
        : readFileSync(`/proc/${pid}/cmdline`, 'utf8');
  } catch {
    log.info('Previous dev instance already exited; nothing to evict', { pid });
    return;
  }

  // The common case on Windows: the predecessor shut down cleanly while this
  // process was still starting, so there is no command line left to inspect.
  if (!line.trim()) {
    log.info('Previous dev instance already exited; nothing to evict', { pid });
    return;
  }
  if (!/server[\/]index\.ts/.test(line)) {
    log.warn('Recorded dev pid is not this API; leaving it alone', { pid });
    return;
  }

  log.warn('Evicting the previous dev API that still holds the port', { pid });
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
    } else {
      process.kill(pid, 'SIGKILL');
    }
  } catch (err) {
    log.warn('Could not evict the previous dev API', { pid, error: String(err) });
  }
}

function recordPid(pidFile: string): void {
  try {
    writeFileSync(pidFile, String(process.pid), 'utf8');
  } catch {
    // A read-only working directory must not stop the server from running.
  }
}

function clearPid(pidFile: string): void {
  try {
    rmSync(pidFile, { force: true });
  } catch {
    // Best effort.
  }
}


function start(): void {
  let rt: Runtime;
  try {
    rt = createRuntime();
  } catch (err) {
    // A configuration mistake is an operator error, not a bug, and the thrown
    // `ConfigError` already lists every problem at once. Printing the raw stack
    // would bury the one line that says what to change.
    if (err instanceof ConfigError) {
      console.error(`\nHaniMarket API cannot start:\n\n  ${err.problems.join('\n  ')}\n`);
      process.exit(1);
    }
    throw err;
  }

  const { app, config: cfg, log, sessions, persistence, db, restored, savedAt } = rt;

  // Development only: make sure we are the one serving this port. Ownership is
  // claimed in the listen callback, because a process that never binds is not
  // the port owner and must not clear the predecessor's record.
  const devPidFile = cfg.env === 'production' ? null : resolvePidFile(cfg.devPidFile);
  if (devPidFile) evictStaleInstance(devPidFile, log);

  const server = listenWithRetry(app, cfg.port, cfg.env, log, (attempt) => {
    if (devPidFile) {
      recordPid(devPidFile);
      process.on('exit', () => clearPid(devPidFile));
    }
    log.info('HaniMarket API listening', {
      port: cfg.port,
      env: cfg.env,
      origin: cfg.publicOrigin ?? '(dev allowlist only)',
      allowedOrigins: cfg.allowedOrigins,
      restored,
      savedAt,
      persistence: cfg.persistence.mode,
      ledgerBalanced: ledgerBalances(db.ledger),
      counts: {
        products: db.products.length,
        orders: db.orders.length,
        users: db.users.length,
        ledgerEntries: db.ledger.length,
      },
      auth: {
        cookie: cfg.session.cookieName,
        secure: cfg.session.secureCookies,
        ttlMs: cfg.session.ttlMs,
      },
      roleSwitch: cfg.allowRoleSwitch ? 'admin-only' : 'disabled',
      providers: {
        payments: `${cfg.providers.payments.provider}/${cfg.providers.payments.mode}`,
        shipping: `${cfg.providers.shipping.mode}`,
        sms: `${cfg.providers.sms.mode}`,
      },
      ...(attempt > 0 ? { reboundAfterBusyPort: attempt } : {}),
    });
  });

  /**
   * Graceful shutdown: stop accepting connections, let in-flight requests finish,
   * then flush. The timeout is a backstop, not a plan — a request that cannot
   * finish in time is a bug, and losing a snapshot is better than hanging a
   * deploy forever.
   */
  let shuttingDown = false;
  const shutdown = (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    log.info('Shutting down', { signal });

    const force = setTimeout(() => {
      log.warn('Shutdown timed out; exiting with the last persisted snapshot', { timeoutMs: cfg.shutdownTimeoutMs });
      process.exit(1);
    }, cfg.shutdownTimeoutMs);
    force.unref();

    server.close(() => {
      sessions.stop();
      void persistence
        .close()
        .then(() => {
          log.info('Shutdown complete', { stats: persistence.stats() });
          process.exit(0);
        })
        .catch((err) => {
          log.error('Final snapshot failed', { error: err });
          process.exit(1);
        });
    });
    // Keeps a keep-alive socket from delaying the close callback indefinitely.
    server.closeIdleConnections?.();
  };

  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
  process.on('unhandledRejection', (reason) => {
    log.error('Unhandled promise rejection', { error: reason instanceof Error ? { name: reason.name, message: reason.message, stack: reason.stack } : reason });
  });
  process.on('uncaughtException', (err) => {
    // The process state is unknown after this, so it is logged and the process
    // is replaced. `tsx watch` and any process manager start a fresh one.
    log.error('Uncaught exception; exiting', { error: { name: err.name, message: err.message, stack: err.stack } });
    shutdown('uncaughtException');
  });
}

// Only when run as the entry point: importing this module for `createRuntime`
// must not bind a port. `pathToFileURL` rather than string concatenation, because
// the argv path is a filesystem path and `import.meta.url` is a percent-encoded
// URL — they disagree the moment the checkout has a space in its name.
const entry = process.argv[1];
if (entry && import.meta.url === pathToFileURL(entry).href) {
  start();
}
