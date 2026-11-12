import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import type { NextFunction, Request, Response } from 'express';
import type { Role, User } from '../../shared/types.ts';
import type { Db } from '../store.ts';
import type { Config } from '../config.ts';

export const SESSION_COOKIE = 'hm_session';
export const SESSION_TTL_MS = 12 * 60 * 60 * 1000;

const KEY_LENGTH = 64;

/**
 * A hash that is guaranteed never to verify. Login runs the password check
 * against this when the email is unknown, so a missing account and a wrong
 * password take the same time and leak the same thing: nothing.
 */
export const DUMMY_HASH =
  '538a6e02d6e128b74936609664beedea:265676e80b83fac94892c913d32580dad8dc9c5d9e0faf0bdc3a35d057902e7544e109652d9c4c3c0c74771288dc3fe04c5015eb8be408a15e841caf9b2bb1ec';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      /** Populated by `sessionMiddleware` from the session cookie. */
      user?: User;
    }
  }
}

/** scrypt, per-password salt, stored as `saltHex:hashHex`. */
export function hashPassword(plain: string): string {
  const salt = randomBytes(16);
  return `${salt.toString('hex')}:${scryptSync(plain, salt, KEY_LENGTH).toString('hex')}`;
}

/** Constant-time comparison, so a wrong password cannot be timed out character by character. */
export function verifyPassword(plain: string, stored: string): boolean {
  const [saltHex, hashHex] = stored.split(':');
  if (!saltHex || !hashHex) return false;
  const expected = Buffer.from(hashHex, 'hex');
  const actual = scryptSync(plain, Buffer.from(saltHex, 'hex'), expected.length);
  return expected.length === actual.length && timingSafeEqual(expected, actual);
}

export function readCookie(req: Request, name: string): string | undefined {
  const raw = req.headers.cookie;
  if (!raw) return undefined;
  for (const part of raw.split(';')) {
    const at = part.indexOf('=');
    if (at === -1) continue;
    if (part.slice(0, at).trim() !== name) continue;
    try {
      return decodeURIComponent(part.slice(at + 1).trim());
    } catch {
      return undefined;
    }
  }
  return undefined;
}

export interface CookieOptions {
  httpOnly: true;
  sameSite: 'lax';
  secure: boolean;
  path: string;
}

/**
 * The session cookie is httpOnly so script on the page cannot read it, `lax` so
 * a cross-site POST cannot ride it, and `secure` in production so it never
 * crosses plain http. The browser is the only thing that needs to keep it.
 */
export function cookieOptions(cfg?: Config): CookieOptions {
  const secure = cfg ? cfg.session.secureCookies : process.env.NODE_ENV === 'production';
  return { httpOnly: true, sameSite: 'lax', secure, path: '/' };
}

export function sessionCookieName(cfg?: Config): string {
  return cfg?.session.cookieName ?? SESSION_COOKIE;
}

export interface SessionRecord {
  token: string;
  userId: string;
  createdAt: number;
  expiresAt: number;
}

/**
 * Sessions held in memory for this process.
 *
 * The interface is deliberately small so a shared store (Redis, a table) can be
 * swapped in without touching a route: everything below only needs create, get,
 * destroy and destroyForUser. What that swap buys is multi-instance operation —
 * today, signing in on one instance does not sign you in on another, which is
 * why the deploy notes require a single instance or a sticky session until then.
 */
export class SessionStore {
  private readonly byToken = new Map<string, SessionRecord>();
  private readonly ttlMs: number;
  private readonly now: () => number;
  private sweeping: NodeJS.Timeout | null = null;

  constructor(ttlMs: number = SESSION_TTL_MS, now: () => number = Date.now) {
    this.ttlMs = ttlMs;
    this.now = now;
  }

  create(userId: string): SessionRecord {
    const now = this.now();
    const rec: SessionRecord = {
      token: randomBytes(32).toString('base64url'),
      userId,
      createdAt: now,
      expiresAt: now + this.ttlMs,
    };
    this.byToken.set(rec.token, rec);
    this.startSweeper();
    return rec;
  }

  /** Returns the record only if it exists and has not expired. */
  get(token: string): SessionRecord | undefined {
    const rec = this.byToken.get(token);
    if (!rec) return undefined;
    if (rec.expiresAt <= this.now()) {
      this.byToken.delete(token);
      return undefined;
    }
    return rec;
  }

  destroy(token: string): void {
    this.byToken.delete(token);
  }

  /** Used on password change and on the role-switch endpoint to evict the old identity. */
  destroyForUser(userId: string): void {
    for (const [token, rec] of this.byToken) {
      if (rec.userId === userId) this.byToken.delete(token);
    }
  }

  prune(): void {
    const now = this.now();
    for (const [token, rec] of this.byToken) {
      if (rec.expiresAt <= now) this.byToken.delete(token);
    }
  }

  /**
   * Expired sessions are swept on a timer rather than only on access. Without
   * this, a token that nobody presents again stays in the map for the life of
   * the process, which is a slow leak on a long-running instance.
   */
  private startSweeper(): void {
    if (this.sweeping) return;
    const period = Math.max(30_000, Math.floor(this.ttlMs / 4));
    this.sweeping = setInterval(() => this.prune(), period);
    this.sweeping.unref?.();
  }

  stop(): void {
    if (this.sweeping) {
      clearInterval(this.sweeping);
      this.sweeping = null;
    }
  }

  get size(): number {
    return this.byToken.size;
  }
}

/**
 * Resolve the session cookie into `req.user` on every request. It never rejects:
 * anonymous browsing is allowed, and the routers decide who needs an identity. An
 * expired or unknown token is treated as signed out.
 */
export function sessionMiddleware(db: Db, sessions: SessionStore, cfg?: Config) {
  const cookieName = sessionCookieName(cfg);
  return (req: Request, _res: Response, next: NextFunction) => {
    const token = readCookie(req, cookieName);
    if (token) {
      const rec = sessions.get(token);
      const user = rec ? db.users.find((u) => u.id === rec.userId) : undefined;
      // A cookie minted before the account was suspended stops working on the
      // next request, rather than leaving a suspended account browsing the
      // marketplace for the rest of the TTL.
      if (user && !user.suspended) req.user = user;
    }
    next();
  };
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  if (!req.user) {
    res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
    return;
  }
  next();
}

/** Admins pass every role gate: they inspect every surface by design. */
export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction) => {
    if (!req.user) {
      res.status(401).json({ error: 'unauthenticated', message: 'Sign in to continue.' });
      return;
    }
    if (req.user.role !== 'admin' && !roles.includes(req.user.role)) {
      res.status(403).json({
        error: 'forbidden',
        message: `This area is for ${roles.join(' and ')} accounts.`,
      });
      return;
    }
    next();
  };
}

/** The body every session-shaped endpoint returns, so the client has one contract. */
export function sessionPayload(db: Db, user: User | undefined) {
  if (!user) {
    return {
      authenticated: false,
      user: null,
      org: null,
      unread: 0,
      cartCount: 0,
      serverTime: new Date().toISOString(),
      ledgerBalanced: true,
    };
  }
  return {
    authenticated: true,
    user,
    org: user.orgId ? db.orgs.find((o) => o.id === user.orgId) : null,
    unread: db.notifications.filter((n) => n.audience === user.role && !n.read).length,
    cartCount: (db.carts.find((c) => c.userId === user.id)?.lines ?? []).reduce((a, c) => a + c.qty, 0),
    serverTime: new Date().toISOString(),
    ledgerBalanced: true,
  };
}
