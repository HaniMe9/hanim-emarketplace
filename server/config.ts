/**
 * Environment configuration, validated once at boot.
 *
 * Every deployment knob the server reads is resolved here and nowhere else.
 * Two reasons: a typo in a variable name fails at boot with a clear message
 * instead of silently defaulting to a development value in production, and
 * there is exactly one place to audit what the process believes about its own
 * environment.
 *
 * The important part is `assertProductionReady`. Development defaults are chosen
 * to make `npm run dev` work with no setup at all. Those same defaults would be
 * dangerous in production — a fixed OTP code, a permissive CORS origin, the
 * demo role switch — so rather than trusting operators to remember, the process
 * refuses to start if a development affordance is still switched on when
 * `NODE_ENV=production`.
 */

export type NodeEnv = 'development' | 'test' | 'production';
export type LogLevel = 'debug' | 'info' | 'warn' | 'error';
export type PersistenceMode = 'sqlite' | 'memory';

export interface Config {
  env: NodeEnv;
  isProduction: boolean;
  isTest: boolean;
  port: number;
  /** Public origin of the web app, used for CORS and cookie/redirect decisions. */
  publicOrigin: string | null;
  allowedOrigins: string[];
  logLevel: LogLevel;
  /** Number of reverse-proxy hops to trust for `req.ip`. 0 disables it. */
  trustProxyHops: number;
  session: {
    ttlMs: number;
    cookieName: string;
    /** Require the `Secure` cookie attribute. Forced on in production. */
    secureCookies: boolean;
  };
  persistence: {
    mode: PersistenceMode;
    /** SQLite file path. Only used when mode is `sqlite`. */
    path: string;
    /** How often a dirty snapshot is flushed to disk. */
    flushIntervalMs: number;
    /** Run the seed if the database is empty. Off in production by default. */
    seedIfEmpty: boolean;
  };
  otp: {
    /** Fixed OTP — a sandbox escape hatch that must never reach production. */
    fixedCode: boolean;
    maxAttempts: number;
    ttlMs: number;
  };
  /** Demo affordance: sign in as another seeded account. Admin-only, never in production. */
  allowRoleSwitch: boolean;
  providers: {
    payments: PaymentProviderConfig;
    shipping: ShippingProviderConfig;
    sms: SmsProviderConfig;
  };
  /** Shared secret verifying inbound provider webhooks. */
  webhookSecret: string;
  /** Reject requests whose body exceeds this many bytes. */
  bodyLimit: string;
  shutdownTimeoutMs: number;
  /**
   * Where a dev instance records its own pid. On startup a dev instance uses it
   * to evict a predecessor that never released the port; production ignores it.
   */
  devPidFile: string;
}

export interface PaymentProviderConfig {
  /** `sandbox` simulates the provider; `live` performs real HTTP calls. */
  mode: 'sandbox' | 'live';
  provider: 'telebirr' | 'cbe_birr' | 'awash' | 'sandbox';
  baseUrl: string;
  appId: string;
  appSecret: string;
  /** Webhook secret for this provider, falls back to the global one. */
  webhookSecret: string;
  timeoutMs: number;
  /** Percentage retained by the processor, used to book the PSP expense. */
  feeRate: number;
}

export interface ShippingProviderConfig {
  mode: 'sandbox' | 'live';
  providers: string[];
  baseUrl: string;
  apiKey: string;
  timeoutMs: number;
}

export interface SmsProviderConfig {
  mode: 'sandbox' | 'live';
  provider: 'sandbox' | 'ethiotelecom' | 'africastalking';
  baseUrl: string;
  apiKey: string;
  from: string;
  timeoutMs: number;
}

export class ConfigError extends Error {
  readonly problems: string[];
  constructor(problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join('\n  - ')}`);
    this.name = 'ConfigError';
    this.problems = problems;
  }
}

type Env = Record<string, string | undefined>;

const str = (env: Env, key: string, fallback: string): string => {
  const raw = env[key];
  return raw === undefined || raw === '' ? fallback : raw;
};

const int = (env: Env, key: string, fallback: number, problems: string[], min = 0): number => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || !Number.isInteger(n) || n < min) {
    problems.push(`${key} must be an integer >= ${min} (received "${raw}")`);
    return fallback;
  }
  return n;
};

const bool = (env: Env, key: string, fallback: boolean): boolean => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw === 'true' || raw === '1' || raw === 'yes' || raw === 'on';
};

const oneOf = <T extends string>(env: Env, key: string, allowed: readonly T[], fallback: T, problems: string[]): T => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  if (!(allowed as readonly string[]).includes(raw)) {
    problems.push(`${key} must be one of ${allowed.join(' | ')} (received "${raw}")`);
    return fallback;
  }
  return raw as T;
};

const list = (env: Env, key: string, fallback: string[]): string[] => {
  const raw = env[key];
  if (raw === undefined || raw === '') return fallback;
  return raw
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean);
};

function nodeEnv(env: Env, problems: string[]): NodeEnv {
  const raw = (env.NODE_ENV ?? '').trim();
  if (raw === '') return 'development';
  if (raw === 'development' || raw === 'test' || raw === 'production') return raw;
  problems.push(`NODE_ENV must be development | test | production (received "${raw}")`);
  return 'development';
}

export function loadConfig(env: Env = process.env): Config {
  const problems: string[] = [];

  const resolvedEnv = nodeEnv(env, problems);
  const isProduction = resolvedEnv === 'production';
  const isTest = resolvedEnv === 'test';

  const publicOriginRaw = env.PUBLIC_ORIGIN?.trim();
  const publicOrigin = publicOriginRaw ? publicOriginRaw.replace(/\/+$/, '') : null;
  if (publicOrigin && !/^https?:\/\//.test(publicOrigin)) {
    problems.push(`PUBLIC_ORIGIN must be an absolute http(s) URL (received "${publicOrigin}")`);
  }

  // Development origins are only trusted when not in production: in production
  // the allowlist is exactly what the operator configured, so a forgotten
  // variable cannot silently leave localhost origins accepted.
  const devOrigins = ['http://localhost:5173', 'http://127.0.0.1:5173'];
  const configuredOrigins = list(env, 'HM_ALLOWED_ORIGINS', []);
  const allowedOrigins = [...new Set([...(publicOrigin ? [publicOrigin] : []), ...configuredOrigins, ...(isProduction ? [] : devOrigins)])];

  const trustProxyHops = int(env, 'HM_TRUST_PROXY', 0, problems, 0);
  const persistenceMode = oneOf(env, 'HM_PERSISTENCE', ['sqlite', 'memory'] as const, isTest ? 'memory' : 'sqlite', problems);

  const webhookSecret = str(env, 'HM_WEBHOOK_SECRET', isProduction ? '' : 'dev-webhook-secret');
  if (isProduction && webhookSecret.length < 32) {
    problems.push('HM_WEBHOOK_SECRET is required in production and must be at least 32 characters');
  }

  const cfg: Config = {
    env: resolvedEnv,
    isProduction,
    isTest,
    port: int(env, 'PORT', 4000, problems, 1),
    publicOrigin,
    allowedOrigins,
    logLevel: oneOf(env, 'HM_LOG_LEVEL', ['debug', 'info', 'warn', 'error'] as const, isProduction ? 'info' : 'info', problems),
    trustProxyHops,
    session: {
      ttlMs: int(env, 'HM_SESSION_TTL_MS', 12 * 60 * 60 * 1000, problems, 60_000),
      cookieName: str(env, 'HM_SESSION_COOKIE', 'hm_session'),
      secureCookies: bool(env, 'HM_SECURE_COOKIES', isProduction),
    },
    persistence: {
      mode: persistenceMode,
      path: str(env, 'HM_DB_PATH', isTest ? ':memory:' : './data/hanimarket.db'),
      flushIntervalMs: int(env, 'HM_DB_FLUSH_MS', 1500, problems, 100),
      seedIfEmpty: bool(env, 'HM_SEED_IF_EMPTY', !isProduction),
    },
    otp: {
      // Compared as a string, not parsed as a boolean: the meaningful values are
      // `fixed` and unset, and `bool('fixed')` is false, which would silently
      // leave the sandbox escape hatch off.
      fixedCode: str(env, 'HM_DEV_OTP', '') === 'fixed',
      maxAttempts: int(env, 'HM_OTP_MAX_ATTEMPTS', 5, problems, 1),
      ttlMs: int(env, 'HM_OTP_TTL_MS', 5 * 60 * 1000, problems, 10_000),
    },
    // Constrained to three known values rather than "anything but off", so a typo
    // like `HM_ALLOW_ROLE_SWITCH=admin_only` fails at boot instead of quietly
    // enabling a feature that hands out other people's sessions.
    allowRoleSwitch: oneOf(env, 'HM_ALLOW_ROLE_SWITCH', ['off', 'admin-only', 'on'] as const, isProduction ? 'off' : 'admin-only', problems) !== 'off',
    providers: {
      payments: {
        mode: oneOf(env, 'HM_PAYMENTS_MODE', ['sandbox', 'live'] as const, isProduction ? 'live' : 'sandbox', problems),
        provider: oneOf(env, 'HM_PAYMENTS_PROVIDER', ['telebirr', 'cbe_birr', 'awash', 'sandbox'] as const, 'sandbox', problems),
        baseUrl: str(env, 'HM_PAYMENTS_BASE_URL', 'https://sandbox.telebirr.com/api/v1'),
        appId: str(env, 'HM_PAYMENTS_APP_ID', isProduction ? '' : 'sandbox-app-id'),
        appSecret: str(env, 'HM_PAYMENTS_APP_SECRET', isProduction ? '' : 'sandbox-app-secret'),
        webhookSecret: str(env, 'HM_PAYMENTS_WEBHOOK_SECRET', webhookSecret),
        timeoutMs: int(env, 'HM_PAYMENTS_TIMEOUT_MS', 15_000, problems, 500),
        feeRate: Number(env.HM_PAYMENTS_FEE_RATE ?? '0.011'),
      },
      shipping: {
        mode: oneOf(env, 'HM_SHIPPING_MODE', ['sandbox', 'live'] as const, isProduction ? 'live' : 'sandbox', problems),
        providers: list(env, 'HM_SHIPPING_PROVIDERS', ['hanimarket_courier', 'ethio_post']),
        baseUrl: str(env, 'HM_SHIPPING_BASE_URL', 'https://api.shipping.example.et/v1'),
        apiKey: str(env, 'HM_SHIPPING_API_KEY', isProduction ? '' : 'sandbox-key'),
        timeoutMs: int(env, 'HM_SHIPPING_TIMEOUT_MS', 15_000, problems, 500),
      },
      sms: {
        mode: oneOf(env, 'HM_SMS_MODE', ['sandbox', 'live'] as const, isProduction ? 'live' : 'sandbox', problems),
        provider: oneOf(env, 'HM_SMS_PROVIDER', ['sandbox', 'ethiotelecom', 'africastalking'] as const, 'sandbox', problems),
        baseUrl: str(env, 'HM_SMS_BASE_URL', 'https://api.sms.example.et/v1'),
        apiKey: str(env, 'HM_SMS_API_KEY', isProduction ? '' : 'sandbox-key'),
        from: str(env, 'HM_SMS_FROM', 'HaniMarket'),
        timeoutMs: int(env, 'HM_SMS_TIMEOUT_MS', 10_000, problems, 500),
      },
    },
    webhookSecret,
    bodyLimit: str(env, 'HM_BODY_LIMIT', '1mb'),
    shutdownTimeoutMs: int(env, 'HM_SHUTDOWN_TIMEOUT_MS', 15_000, problems, 1000),
    devPidFile: str(env, 'HM_DEV_PID_FILE', '.hm-api.pid').trim() || '.hm-api.pid',
  };

  if (Number.isFinite(cfg.providers.payments.feeRate) && cfg.providers.payments.feeRate < 0) {
    problems.push('HM_PAYMENTS_FEE_RATE must be a non-negative number');
  }

  const problemsFromInvariants = isProduction ? productionInvariants(cfg, env) : [];
  const all = [...problems, ...problemsFromInvariants];
  if (all.length) throw new ConfigError(all);
  return cfg;
}

/**
 * Refusals that apply only in production.
 *
 * Each of these is a development convenience that becomes a production
 * incident: a constant OTP is a universal key for capturing any order, role
 * switching hands out every seeded account, and a non-secure session cookie
 * travels in cleartext.
 */
function productionInvariants(cfg: Config, env: Env): string[] {
  const problems: string[] = [];

  if (cfg.otp.fixedCode) {
    problems.push('HM_DEV_OTP=fixed is a sandbox escape hatch and must not be set in production');
  }
  if (cfg.allowRoleSwitch) {
    problems.push('HM_ALLOW_ROLE_SWITCH must be "off" in production — it issues sessions for other accounts');
  }
  if (!cfg.session.secureCookies) {
    problems.push('HM_SECURE_COOKIES must be true in production — the session cookie would travel without the Secure flag');
  }
  if (!cfg.trustProxyHops) {
    problems.push(
      'HM_TRUST_PROXY must be set to the number of proxy hops in production — with it unset every client shares one address and rate limiting collapses',
    );
  }
  if (!cfg.publicOrigin) {
    problems.push('PUBLIC_ORIGIN is required in production so credentialed requests can be restricted to your own site');
  }
  if (cfg.providers.payments.mode === 'live' && !cfg.providers.payments.appSecret) {
    problems.push('HM_PAYMENTS_APP_SECRET is required when HM_PAYMENTS_MODE=live');
  }
  if (cfg.providers.payments.mode === 'live' && !cfg.providers.payments.appId) {
    problems.push('HM_PAYMENTS_APP_ID is required when HM_PAYMENTS_MODE=live');
  }
  if (cfg.providers.shipping.mode === 'live' && !cfg.providers.shipping.apiKey) {
    problems.push('HM_SHIPPING_API_KEY is required when HM_SHIPPING_MODE=live');
  }
  if (cfg.providers.sms.mode === 'live' && !cfg.providers.sms.apiKey) {
    problems.push('HM_SMS_API_KEY is required when HM_SMS_MODE=live');
  }
  if (cfg.persistence.mode === 'memory') {
    problems.push('HM_PERSISTENCE=memory discards all data on restart and must not be used in production');
  }
  if (env.HM_SEED_IF_EMPTY === 'true' && cfg.isProduction) {
    problems.push('HM_SEED_IF_EMPTY must not be true in production — demo accounts would be created on an empty database');
  }
  return problems;
}

let cached: Config | null = null;

/** The validated configuration for this process. Loaded once, on first use. */
export function config(): Config {
  if (!cached) cached = loadConfig();
  return cached;
}

/** Test hook: install a configuration directly instead of reading the environment. */
export function setConfig(cfg: Config | null): void {
  cached = cfg;
}

/** A configuration suitable for tests: in-memory, no secrets, sandbox providers. */
export function testConfig(overrides: Partial<Config> = {}): Config {
  const base = loadConfig({ NODE_ENV: 'test', HM_DEV_OTP: 'fixed' });
  const cfg: Config = { ...base, ...overrides };
  // Nested objects are replaced wholesale, so merge the common cases.
  cfg.session = { ...base.session, ...(overrides.session ?? {}) };
  cfg.persistence = { ...base.persistence, ...(overrides.persistence ?? {}) };
  cfg.otp = { ...base.otp, ...(overrides.otp ?? {}) };
  cfg.providers = {
    payments: { ...base.providers.payments, ...(overrides.providers?.payments ?? {}) },
    shipping: { ...base.providers.shipping, ...(overrides.providers?.shipping ?? {}) },
    sms: { ...base.providers.sms, ...(overrides.providers?.sms ?? {}) },
  };
  return cfg;
}
