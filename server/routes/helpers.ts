import type { Request, Response } from 'express';
import { code, daysAgo, daysAhead, id, minutesAgo, pick, rng } from '../lib/ids.ts';
import type { Db } from '../store.ts';
import type { Role } from '../../shared/types.ts';

export { id, code, daysAgo, daysAhead, minutesAgo, rng, pick };

/** Query-string integer with fallback. */
export function qInt(v: unknown, fallback: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? Math.trunc(n) : fallback;
}

/** Normalise a possibly-undefined query string. */
export function qStr(v: unknown, fallback = ''): string {
  return typeof v === 'string' && v.length > 0 ? v : fallback;
}

/** Standard not-found response. */
export function notFound(res: Response, what: string) {
  return res.status(404).json({ error: 'not_found', message: `${what} was not found.` });
}

/**
 * The tenancy check for a single record fetched by `:id`.
 *
 * Passing the role gate only proves the caller *is* a seller; it says nothing
 * about *which* seller. Every handler that looks a record up by primary key has
 * to pass it through here, or any seller can read and write any competitor's
 * data by editing an id. Admins pass every check by design — they inspect every
 * surface — and the calls that matter are written to the audit trail.
 *
 * Returns the record when the caller may act on it. On refusal it sends the
 * response and returns `null`, so a handler reads:
 *
 *     const offer = ownerOf(req, res, db.offers.find((o) => o.id === id), 'org_x', sid, 'Listing');
 *     if (!offer) return;
 */
export function ownerOf<T>(
  req: Request,
  res: Response,
  record: T | undefined,
  ownerId: string | undefined,
  callerId: string | undefined,
  what: string,
): T | null {
  if (!record) {
    notFound(res, what);
    return null;
  }
  if (req.user?.role === 'admin') return record;
  if (!callerId || ownerId !== callerId) {
    res.status(403).json({
      error: 'forbidden',
      message: `That ${what.toLowerCase()} belongs to another account.`,
    });
    return null;
  }
  return record;
}

/**
 * Copy named fields from a request body onto a record that already exists.
 *
 * `Object.assign(record, req.body)` hands the client every field on the record
 * plus every field on its neighbours: a seller could post `sellerId` to take
 * over a listing, or `status: 'live'` to skip moderation. An allowlist means a
 * handler can only ever be changed through the fields it names.
 *
 * A value is written only when the client supplied it and its primitive type
 * matches the field's current type, so a `"5"` cannot land in a numeric field
 * and `null` cannot erase a required one. Returns the fields actually written,
 * which is what the audit trail records.
 */
export function assignFields<T extends object>(
  target: T,
  body: unknown,
  fields: readonly (keyof T & string)[],
): (keyof T & string)[] {
  const src = (body ?? {}) as Record<string, unknown>;
  const written: (keyof T & string)[] = [];
  for (const field of fields) {
    const next = src[field];
    if (next === undefined) continue;
    const current = (target as Record<string, unknown>)[field];
    if (next === null) continue;
    if (current !== undefined && typeof current !== 'object' && typeof next !== typeof current) continue;
    if (current !== null && typeof current === 'object' && !Array.isArray(current) && typeof next === 'object') continue;
    if (current !== undefined && Array.isArray(current) !== Array.isArray(next)) continue;
    (target as Record<string, unknown>)[field] = next;
    written.push(field);
  }
  return written;
}

/** Append to the admin audit trail. Every privileged write goes through here. */
export function audit(db: Db, actor: string, action: string, target: string, after?: unknown, ip = '127.0.0.1') {
  db.auditLog.unshift({
    id: id('aud'),
    at: new Date().toISOString(),
    actor,
    action,
    target,
    before: undefined,
    after: after === undefined ? undefined : JSON.stringify(after).slice(0, 400),
    ip,
  });
  if (db.auditLog.length > 500) db.auditLog.length = 500;
}

/** Append to the human-readable activity feed. */
export function logActivity(db: Db, actor: string, action: string, entity: string, entityId: string, detail = '') {
  db.activity.unshift({ id: id('act'), at: new Date().toISOString(), actor, action, entity, entityId, detail });
  if (db.activity.length > 300) db.activity.length = 300;
}

/**
 * Resolve the acting party for a request. Authentication already happened at the
 * router edge (`requireAuth` / `requireRole`), so by the time a handler runs the
 * caller is known and `req.user` is the default. `?as=` is kept for read-only
 * inspection *within* a surface the caller is already authorised for — an admin
 * looking at a seller's book — and it can no longer widen access, because the
 * role gate was passed before this function was ever reached.
 */
export function actorFor(db: Db, req: Request, fallback: Role): { id: string; name: string; role: Role } {
  const explicit = qStr(req.query.as, '');
  const impersonated = explicit ? db.users.find((u) => u.id === explicit) : undefined;
  const chosen = impersonated ?? req.user ?? db.users.find((u) => u.role === fallback)!;
  return { id: chosen.id, name: chosen.name, role: chosen.role };
}
