import { Router } from 'express';
import type { Request } from 'express';
import type { Db } from '../store.ts';
import { hashPassword } from '../lib/auth.ts';
import type { SessionStore } from '../lib/auth.ts';
import { audit, id, logActivity, notFound, qStr } from './helpers.ts';
import type { Category, Organization, Role, User, VerificationTier } from '../../shared/types.ts';

const ROLES: Role[] = ['buyer', 'business_buyer', 'seller', 'agent', 'admin'];
const TIERS: VerificationTier[] = ['none', 'basic', 'business', 'trusted', 'enterprise'];

/**
 * Directory administration: the people, the sellers and the categories.
 *
 * Two rules run through every handler here.
 *
 * 1. Deleting is not the same as switching off. An account or a seller that has
 *    touched money, orders or the ledger is suspended, not removed, because the
 *    audit trail and the double-entry ledger both point at those rows forever.
 *    Hard delete is offered only where the record is genuinely unreferenced,
 *    and it refuses with a 409 naming every reference rather than cascading.
 * 2. A privileged write is always attributed. Every mutation writes an audit
 *    row with the acting admin's name, and destructive ones write the before
 *    state so the change can be reconstructed.
 */
/**
 * `sessions` is optional so the module can be mounted without one; when it is
 * present a password reset also revokes that account's live sessions.
 */
export function adminDirectoryRoutes(db: Db, sessions?: SessionStore): Router {
  const r = Router();

  const who = (req: Request) => req.user?.name ?? 'Admin';
  const now = () => new Date().toISOString();

  /**
   * Offer ids that a suspension took offline, per organisation.
   *
   * Reinstatement must only revive the listings *the suspension* paused. Without
   * this, reinstating a seller would silently put back listings the seller had
   * paused on purpose — the worst kind of admin surprise, because the seller
   * sees stock going live that they had taken down. The map lives for the life
   * of the process, which is exactly as long as the in-memory database does.
   */
  const pausedBySuspension = new Map<string, Set<string>>();

  function pauseOrgOffers(orgId: string): number {
    const ids = new Set<string>();
    for (const o of db.offers.filter((x) => x.sellerId === orgId && x.status === 'live')) {
      o.status = 'paused';
      ids.add(o.id);
    }
    pausedBySuspension.set(orgId, ids);
    return ids.size;
  }

  /** Put back only what `pauseOrgOffers` took down, then forget the set. */
  function restoreOrgOffers(orgId: string): number {
    const ids = pausedBySuspension.get(orgId);
    if (!ids) return 0;
    let restored = 0;
    for (const o of db.offers.filter((x) => ids.has(x.id) && x.status === 'paused')) {
      o.status = 'live';
      restored += 1;
    }
    pausedBySuspension.delete(orgId);
    return restored;
  }

  /** A slug that is unique across the collection, appending -2, -3 … if needed. */
  function uniqueSlug(base: string, taken: (slug: string) => boolean): string {
    const root = base.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 50) || 'item';
    if (!taken(root)) return root;
    for (let n = 2; n < 200; n += 1) {
      const candidate = `${root}-${n}`;
      if (!taken(candidate)) return candidate;
    }
    return `${root}-${id('x')}`;
  }

  function str(v: unknown): string {
    return typeof v === 'string' ? v.trim() : '';
  }

  /** "2 ledger entries", not "2 ledger entrys" — the kinds have irregular plurals. */
  const PLURAL: Record<string, string> = {
    'ledger entry': 'ledger entries',
    'payout account': 'payout accounts',
  };
  const describeRefs = (refs: { kind: string; count: number }[]) =>
    refs.map((x) => `${x.count} ${x.count === 1 ? x.kind : (PLURAL[x.kind] ?? `${x.kind}s`)}`).join(', ');

  /* ------------------------------- users --------------------------------- */

  /** Everything that would break if this user vanished, for the delete guard. */
  function userReferences(u: User) {
    const orders = db.orders.filter((o) => o.buyerId === u.id);
    // A review carries no author id, so the author is resolved through the
    // order it was left on.
    const orderIds = new Set(orders.map((o) => o.id));
    const reviews = db.reviews.filter((x) => orderIds.has(x.orderId));
    const offers = db.offers.filter((o) => o.sellerId === u.orgId);
    const settlements = db.settlements.filter((s) => s.sellerId === u.orgId);
    const ledger = db.ledger.filter((e) => e.lines.some((l) => l.partyId === u.id));
    return [
      { kind: 'order', count: orders.length },
      { kind: 'dispute', count: db.disputes.filter((d) => d.buyerId === u.id || d.sellerId === u.id).length },
      { kind: 'review', count: reviews.length },
      { kind: 'listing', count: offers.length },
      { kind: 'settlement', count: settlements.length },
      { kind: 'ledger entry', count: ledger.length },
    ].filter((x) => x.count > 0);
  }

  r.get('/directory/users', (req, res) => {
    const q = qStr(req.query.q, '').toLowerCase();
    const role = qStr(req.query.role, '');
    const status = qStr(req.query.status, '');

    const items = db.users
      .filter((u) => (role ? u.role === role : true))
      .filter((u) => (status === 'suspended' ? !!u.suspended : status === 'active' ? !u.suspended : true))
      .filter((u) => (q ? `${u.name} ${u.email} ${u.phone} ${u.city ?? ''}`.toLowerCase().includes(q) : true))
      .map((u) => ({
        ...u,
        orgName: u.orgId ? db.orgs.find((o) => o.id === u.orgId)?.name ?? null : null,
        orders: db.orders.filter((o) => o.buyerId === u.id).length,
        listings: db.offers.filter((o) => o.sellerId === u.orgId).length,
        references: userReferences(u),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));

    res.json({
      items,
      counts: {
        total: db.users.length,
        active: db.users.filter((u) => !u.suspended).length,
        suspended: db.users.filter((u) => u.suspended).length,
        byRole: ROLES.reduce<Record<string, number>>((acc, role2) => ({ ...acc, [role2]: db.users.filter((u) => u.role === role2).length }), {}),
      },
    });
  });

  r.post('/directory/users', (req, res) => {
    const b = req.body as Record<string, unknown>;
    const name = str(b.name);
    const email = str(b.email).toLowerCase();
    const phone = str(b.phone);
    const role = str(b.role) as Role;
    const password = typeof b.password === 'string' ? b.password : '';

    if (!name || !email || !phone) {
      return res.status(422).json({ error: 'invalid', message: 'Name, email and phone are all required.' });
    }
    if (!ROLES.includes(role)) {
      return res.status(422).json({ error: 'invalid', message: `Role must be one of: ${ROLES.join(', ')}.` });
    }
    if (db.users.some((u) => u.email.toLowerCase() === email)) {
      return res.status(409).json({ error: 'duplicate', message: 'An account already uses that email address.' });
    }
    if (password && password.length < 8) {
      return res.status(422).json({ error: 'invalid', message: 'A password must be at least 8 characters.' });
    }

    // An admin creating an account without a password gets one immediately, so
    // the account is never created in a state nobody can sign into.
    const user: User = {
      id: id('u'),
      name,
      email,
      phone,
      role,
      // Deterministic from the id so the avatar is stable without a store.
      avatarHue: (id('h').charCodeAt(2) * 37) % 360,
      city: str(b.city) || 'Addis Ababa',
      orgId: str(b.orgId) || undefined,
      createdAt: now(),
    };
    if (str(b.orgId) && !db.orgs.some((o) => o.id === str(b.orgId))) {
      return res.status(422).json({ error: 'invalid', message: 'That organisation does not exist.' });
    }
    db.users.push(user);
    db.credentials.push({
      userId: user.id,
      hash: hashPassword(password || `hm-${user.id}`),
      updatedAt: now(),
    });

    logActivity(db, who(req), 'user.created', 'user', user.id, `${user.name} · ${user.role}`);
    audit(db, who(req), 'user.create', `user:${user.id}`, { name, email, role });
    res.status(201).json({ user, message: `${user.name} created.` });
  });

  r.patch('/directory/users/:id', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return notFound(res, 'User');
    const b = req.body as Record<string, unknown>;
    const actor = who(req);
    const before = { ...user };

    if (b.name !== undefined) {
      const name = str(b.name);
      if (!name) return res.status(422).json({ error: 'invalid', message: 'Name cannot be empty.' });
      user.name = name;
    }
    if (b.email !== undefined) {
      const email = str(b.email).toLowerCase();
      if (!email || db.users.some((u) => u.id !== user.id && u.email.toLowerCase() === email)) {
        return res.status(409).json({ error: 'duplicate', message: 'Another account already uses that email address.' });
      }
      user.email = email;
    }
    if (b.phone !== undefined) user.phone = str(b.phone) || user.phone;
    if (b.city !== undefined) user.city = str(b.city) || user.city;
    if (b.role !== undefined) {
      const role = str(b.role) as Role;
      if (!ROLES.includes(role)) return res.status(422).json({ error: 'invalid', message: `Role must be one of: ${ROLES.join(', ')}.` });

      // The last usable admin is a hard stop. Locking yourself out of the
      // platform is not a mistake the API should let an admin make.
      if (user.role === 'admin' && role !== 'admin') {
        const others = db.users.filter((u) => u.id !== user.id && u.role === 'admin' && !u.suspended);
        if (!others.length) {
          return res.status(409).json({
            error: 'last_admin',
            message: 'This is the only active admin account. Promote another admin before changing this one.',
          });
        }
      }
      user.role = role;
    }
    if (b.orgId !== undefined) {
      const orgId = str(b.orgId);
      if (orgId && !db.orgs.some((o) => o.id === orgId)) {
        return res.status(422).json({ error: 'invalid', message: 'That organisation does not exist.' });
      }
      user.orgId = orgId || undefined;
    }
    if (typeof b.password === 'string' && b.password.length > 0) {
      if (b.password.length < 12) return res.status(422).json({ error: 'invalid', message: 'A password must be at least 12 characters.' });
      const cred = db.credentials.find((c) => c.userId === user.id);
      if (cred) {
        cred.hash = hashPassword(b.password);
        cred.updatedAt = now();
      } else {
        db.credentials.push({ userId: user.id, hash: hashPassword(b.password), updatedAt: now() });
      }
      // A reset is exactly the moment to evict sessions: whoever prompted it may
      // be responding to a compromise, and leaving stolen cookies working would
      // undo the reset. `destroyForUser` existed but nothing called it.
      sessions?.destroyForUser(user.id);
    }

    audit(db, actor, 'user.update', `user:${user.id}`, { before, after: user });
    res.json({ user, message: `${user.name} updated.` });
  });

  r.delete('/directory/users/:id', (req, res) => {
    const actor = who(req);
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return notFound(res, 'User');

    if (user.id === req.user?.id) {
      return res.status(409).json({ error: 'self_delete', message: 'You cannot delete the account you are signed in with.' });
    }
    if (user.role === 'admin') {
      const others = db.users.filter((u) => u.id !== user.id && u.role === 'admin' && !u.suspended);
      if (!others.length) {
        return res.status(409).json({ error: 'last_admin', message: 'This is the only active admin account and cannot be deleted.' });
      }
    }

    const references = userReferences(user);
    if (references.length) {
      // Money and order history outlive the account that created it, so the
      // right move is to suspend — and say exactly why the delete was refused.
      return res.status(409).json({
        error: 'has_references',
        message: `${user.name} is referenced by ${describeRefs(references)}. Suspend the account instead — deleting it would break the order history and the ledger.`,
        references,
        remedy: 'suspend',
      });
    }

    db.users = db.users.filter((u) => u.id !== user.id);
    db.credentials = db.credentials.filter((c) => c.userId !== user.id);
    db.favoritesByUser = db.favoritesByUser.filter((f) => f.userId !== user.id);
    db.carts = db.carts.filter((c) => c.userId !== user.id);
    logActivity(db, actor, 'user.deleted', 'user', user.id, user.name);
    audit(db, actor, 'user.delete', `user:${user.id}`, { name: user.name, email: user.email });
    res.json({ ok: true, message: `${user.name} deleted. The account had no orders, reviews or ledger entries.` });
  });

  r.post('/directory/users/:id/suspend', (req, res) => {
    const user = db.users.find((u) => u.id === req.params.id);
    if (!user) return notFound(res, 'User');
    const b = req.body as { reason?: string; suspended?: boolean };
    const reason = str(b.reason);
    if (!reason) return res.status(422).json({ error: 'invalid', message: 'A suspension needs a written reason. It is shown to the user.' });

    const next = b.suspended ?? !user.suspended;
    user.suspended = next;
    user.suspendedAt = next ? now() : undefined;
    user.suspendedReason = next ? reason : undefined;

    // A suspended seller must stop trading immediately, not keep live offers.
    // The offer set is remembered so only these are revived on reinstatement.
    const taken = user.orgId ? (next ? pauseOrgOffers(user.orgId) : restoreOrgOffers(user.orgId)) : 0;

    logActivity(db, who(req), next ? 'user.suspended' : 'user.reinstated', 'user', user.id, reason);
    audit(db, who(req), next ? 'user.suspend' : 'user.reinstate', `user:${user.id}`, { reason, offers: taken });
    res.json({
      user,
      message: next
        ? `${user.name} suspended. They can no longer sign in${taken ? `, and ${taken} listing(s) were taken offline` : ''}.`
        : `${user.name} reinstated${taken ? `, and ${taken} listing(s) are live again` : ''}.`,
    });
  });

  /* ------------------------------- sellers -------------------------------- */

  function sellerReferences(o: Organization) {
    return [
      { kind: 'listing', count: db.offers.filter((x) => x.sellerId === o.id).length },
      { kind: 'order', count: db.orders.filter((x) => x.lines.some((l) => l.sellerId === o.id)).length },
      { kind: 'settlement', count: db.settlements.filter((x) => x.sellerId === o.id).length },
      { kind: 'dispute', count: db.disputes.filter((x) => x.sellerId === o.id).length },
      { kind: 'payout account', count: db.payoutAccounts.filter((x) => x.sellerId === o.id).length },
      { kind: 'ledger entry', count: db.ledger.filter((e) => e.lines.some((l) => l.partyId === o.id)).length },
      { kind: 'user', count: db.users.filter((u) => u.orgId === o.id).length },
    ].filter((x) => x.count > 0);
  }

  r.get('/directory/sellers', (req, res) => {
    const q = qStr(req.query.q, '').toLowerCase();
    const type = qStr(req.query.type, '');

    const items = db.orgs
      .filter((o) => (type ? o.type === type : true))
      .filter((o) => (q ? `${o.name} ${o.city} ${o.email}`.toLowerCase().includes(q) : true))
      .map((o) => ({
        ...o,
        listingCount: db.offers.filter((x) => x.sellerId === o.id).length,
        liveListings: db.offers.filter((x) => x.sellerId === o.id && x.status === 'live').length,
        orderCount: db.orders.filter((x) => x.lines.some((l) => l.sellerId === o.id)).length,
        memberCount: db.users.filter((u) => u.orgId === o.id).length,
        references: sellerReferences(o),
      }))
      .sort((a, b) => b.sales30d - a.sales30d);

    res.json({
      items,
      counts: {
        total: db.orgs.length,
        sellers: db.orgs.filter((o) => o.type === 'seller').length,
        buyerOrgs: db.orgs.filter((o) => o.type === 'buyer_org').length,
        suspended: db.orgs.filter((o) => o.suspended).length,
      },
    });
  });

  r.post('/directory/sellers', (req, res) => {
    const b = req.body as Record<string, unknown>;
    const name = str(b.name);
    const city = str(b.city);
    const email = str(b.email).toLowerCase();
    const phone = str(b.phone);
    const type = str(b.type) === 'buyer_org' ? 'buyer_org' : 'seller';

    if (!name || !city) return res.status(422).json({ error: 'invalid', message: 'Name and city are required.' });
    if (db.orgs.some((o) => o.name.toLowerCase() === name.toLowerCase())) {
      return res.status(409).json({ error: 'duplicate', message: 'An organisation with that name already exists.' });
    }

    const org: Organization = {
      id: id('org'),
      slug: uniqueSlug(name, (s) => db.orgs.some((o) => o.slug === s)),
      name,
      nameAm: str(b.nameAm) || name,
      type,
      city,
      region: str(b.region) || city,
      // A new seller starts unverified and unpublished. Verification is a
      // human decision reached through the KYC queue, never a form field.
      tier: 'none',
      trustScore: 0,
      rating: 0,
      reviewCount: 0,
      logoText: name.slice(0, 2).toUpperCase(),
      hue: (id('h').charCodeAt(2) * 37) % 360,
      deliverySuccessRate: 0,
      cancellationRate: 0,
      disputeRate: 0,
      responseTimeHours: 0,
      sales30d: 0,
      joinedAt: now(),
      phone: phone || `+2519${String(Math.floor(Math.random() * 100000000)).padStart(8, '0')}`,
      email: email || `${uniqueSlug(name, (s) => db.orgs.some((o) => o.slug === s))}@example.et`,
      categories: Array.isArray(b.categories) ? (b.categories as string[]) : [],
      published: false,
      suspended: false,
      description: str(b.description),
      kyc: { status: 'not_started', checks: [], documents: [] },
    };
    db.orgs.push(org);

    logActivity(db, who(req), 'seller.created', 'org', org.id, org.name);
    audit(db, who(req), 'seller.create', `org:${org.id}`, { name, type, city });
    res.status(201).json({
      org,
      message: `${org.name} created. It is unpublished and tier "none" until a verification case is approved.`,
    });
  });

  r.patch('/directory/sellers/:id', (req, res) => {
    const org = db.orgs.find((o) => o.id === req.params.id);
    if (!org) return notFound(res, 'Organization');
    const b = req.body as Record<string, unknown>;
    const actor = who(req);
    const before = { ...org };

    for (const field of ['name', 'nameAm', 'city', 'region', 'phone', 'email', 'description'] as const) {
      if (b[field] !== undefined) {
        const next = str(b[field]);
        // `description` may legitimately be cleared; the rest may not go blank.
        if (!next && field !== 'description') {
          return res.status(422).json({ error: 'invalid', message: `${field} cannot be empty.` });
        }
        org[field] = next;
      }
    }
    if (b.categories !== undefined && Array.isArray(b.categories)) {
      const ids = b.categories as string[];
      const missing = ids.filter((c) => !db.categories.some((x) => x.id === c));
      if (missing.length) return res.status(422).json({ error: 'invalid', message: `Unknown category: ${missing.join(', ')}.` });
      org.categories = ids;
    }
    if (b.tier !== undefined) {
      const tier = str(b.tier) as VerificationTier;
      if (!TIERS.includes(tier)) return res.status(422).json({ error: 'invalid', message: `Tier must be one of: ${TIERS.join(', ')}.` });
      org.tier = tier;
      // Publishing follows the tier: an unverified seller cannot be visible.
      org.published = tier !== 'none';
    }
    if (b.published !== undefined) {
      const published = Boolean(b.published);
      if (published && org.tier === 'none') {
        return res.status(409).json({
          error: 'not_verified',
          message: `${org.name} is tier "none". Approve a verification case before publishing the storefront.`,
        });
      }
      org.published = published;
    }

    audit(db, actor, 'seller.update', `org:${org.id}`, { before, after: org });
    res.json({ org, message: `${org.name} updated.` });
  });

  r.delete('/directory/sellers/:id', (req, res) => {
    const actor = who(req);
    const org = db.orgs.find((o) => o.id === req.params.id);
    if (!org) return notFound(res, 'Organization');

    const references = sellerReferences(org);
    if (references.length) {
      return res.status(409).json({
        error: 'has_references',
        message: `${org.name} is referenced by ${describeRefs(references)}. Suspend the seller instead — deleting it would orphan orders, payouts and ledger lines.`,
        references,
        remedy: 'suspend',
      });
    }

    db.orgs = db.orgs.filter((o) => o.id !== org.id);
    logActivity(db, actor, 'seller.deleted', 'org', org.id, org.name);
    audit(db, actor, 'seller.delete', `org:${org.id}`, { name: org.name });
    res.json({ ok: true, message: `${org.name} deleted. It had no listings, orders, payouts or ledger entries.` });
  });

  r.post('/directory/sellers/:id/suspend', (req, res) => {
    const org = db.orgs.find((o) => o.id === req.params.id);
    if (!org) return notFound(res, 'Organization');
    const b = req.body as { reason?: string; suspended?: boolean };
    const reason = str(b.reason);
    if (!reason) return res.status(422).json({ error: 'invalid', message: 'A suspension needs a written reason. It is shown to buyers and sellers.' });

    const next = b.suspended ?? !org.suspended;
    org.suspended = next;
    if (next) org.published = false;

    // Only the listings this suspension takes down are remembered, so
    // reinstatement never revives something the seller paused themselves.
    const taken = next ? pauseOrgOffers(org.id) : restoreOrgOffers(org.id);

    logActivity(db, who(req), next ? 'seller.suspended' : 'seller.reinstated', 'org', org.id, reason);
    audit(db, who(req), next ? 'seller.suspend' : 'seller.reinstate', `org:${org.id}`, { reason, offers: taken });
    res.json({
      org,
      message: next
        ? `${org.name} suspended and unpublished. ${taken} listing(s) were taken offline; orders already in delivery are unaffected.`
        : `${org.name} reinstated${taken ? `, and ${taken} listing(s) are live again` : ''}. Re-publish the storefront to make it visible.`,
    });
  });

  /* ----------------------------- categories ------------------------------ */

  /**
   * Direct and rolled-up product counts, derived on read rather than stored.
   * This used to be a mutating recount inside a GET handler, which meant every
   * page view rewrote the whole category table — twice the work on two app
   * instances at once, and un-idempotent for anything reading concurrently.
   */
  function categoryCounts(): Map<string, number> {
    const counts = new Map<string, number>();
    for (const p of db.products) {
      const cat = db.categories.find((c) => c.id === p.categoryId);
      if (!cat) continue;
      counts.set(cat.id, (counts.get(cat.id) ?? 0) + 1);
      const root = db.categories.find((c) => c.id === (cat.parentId ?? cat.id));
      if (root && root.id !== cat.id) counts.set(root.id, (counts.get(root.id) ?? 0) + 1);
    }
    return counts;
  }

  /** Persist the derived counts. Only ever called from a write that changed the catalog. */
  function recountCategories() {
    const counts = categoryCounts();
    for (const c of db.categories) c.productCount = counts.get(c.id) ?? 0;
  }

  r.get('/directory/categories', (req, res) => {
    const q = qStr(req.query.q, '').toLowerCase();
    const counts = categoryCounts();

    const roots = db.categories.filter((c) => !c.parentId);
    res.json({
      items: db.categories
        .filter((c) => (q ? `${c.name} ${c.nameAm} ${c.slug}`.toLowerCase().includes(q) : true))
        .map((c) => ({
          ...c,
          productCount: counts.get(c.id) ?? 0,
          children: db.categories.filter((x) => x.parentId === c.id),
          orgCount: db.orgs.filter((o) => o.categories.includes(c.id)).length,
          references: db.products.filter((p) => p.categoryId === c.id).length,
        }))
        .sort((a, b) => {
          // Roots keep their declared order, children sit under their parent.
          const ra = roots.findIndex((r) => r.id === a.id);
          const rb = roots.findIndex((r) => r.id === b.id);
          const ka = a.parentId ? roots.findIndex((r) => r.id === a.parentId) : ra;
          const kb = b.parentId ? roots.findIndex((r) => r.id === b.parentId) : rb;
          return (ka < 0 ? 99 : ka) - (kb < 0 ? 99 : kb) || a.name.localeCompare(b.name);
        }),
      counts: {
        total: db.categories.length,
        roots: roots.length,
        children: db.categories.length - roots.length,
        empty: db.categories.filter((c) => c.productCount === 0).length,
      },
    });
  });

  r.post('/directory/categories', (req, res) => {
    const b = req.body as Record<string, unknown>;
    const name = str(b.name);
    if (!name) return res.status(422).json({ error: 'invalid', message: 'A category needs a name.' });

    const parentId = str(b.parentId);
    if (parentId && !db.categories.some((c) => c.id === parentId)) {
      return res.status(422).json({ error: 'invalid', message: 'That parent category does not exist.' });
    }
    if (parentId && db.categories.find((c) => c.id === parentId)?.parentId) {
      return res.status(422).json({ error: 'invalid', message: 'Categories nest one level deep. Choose a top-level category as the parent.' });
    }

    const cat: Category = {
      id: id('cat'),
      slug: uniqueSlug(name, (s) => db.categories.some((c) => c.slug === s)),
      name,
      nameAm: str(b.nameAm),
      icon: str(b.icon) || 'Boxes',
      parentId: parentId || undefined,
      blurb: str(b.blurb),
      productCount: 0,
      accent: str(b.accent) || '#0369a1',
    };
    db.categories.push(cat);

    logActivity(db, who(req), 'category.created', 'category', cat.id, cat.name);
    audit(db, who(req), 'category.create', `category:${cat.id}`, { name, parentId: parentId || null });
    res.status(201).json({ category: cat, message: `"${cat.name}" created.` });
  });

  r.patch('/directory/categories/:id', (req, res) => {
    const cat = db.categories.find((c) => c.id === req.params.id);
    if (!cat) return notFound(res, 'Category');
    const b = req.body as Record<string, unknown>;
    const before = { ...cat };

    if (b.name !== undefined) {
      const name = str(b.name);
      if (!name) return res.status(422).json({ error: 'invalid', message: 'Name cannot be empty.' });
      cat.name = name;
    }
    if (b.nameAm !== undefined) cat.nameAm = str(b.nameAm);
    if (b.blurb !== undefined) cat.blurb = str(b.blurb);
    if (b.icon !== undefined) cat.icon = str(b.icon) || cat.icon;
    if (b.accent !== undefined) cat.accent = str(b.accent) || cat.accent;
    if (b.slug !== undefined) {
      const slug = str(b.slug);
      if (slug && db.categories.some((c) => c.id !== cat.id && c.slug === slug)) {
        return res.status(409).json({ error: 'duplicate', message: 'Another category already uses that slug.' });
      }
      cat.slug = uniqueSlug(slug, (s) => db.categories.some((c) => c.id !== cat.id && c.slug === s));
    }
    if (b.parentId !== undefined) {
      const parentId = str(b.parentId);
      if (parentId === cat.id) return res.status(422).json({ error: 'invalid', message: 'A category cannot be its own parent.' });
      const parent = db.categories.find((c) => c.id === parentId);
      if (parentId && !parent) return res.status(422).json({ error: 'invalid', message: 'That parent category does not exist.' });
      if (parent?.parentId) {
        return res.status(422).json({ error: 'invalid', message: 'Categories nest one level deep. Choose a top-level category as the parent.' });
      }
      // Moving a parent would orphan the whole subtree underneath it.
      if (db.categories.some((c) => c.parentId === cat.id)) {
        return res.status(409).json({
          error: 'has_children',
          message: `"${cat.name}" has sub-categories. Move them first — re-parenting it would orphan them.`,
        });
      }
      cat.parentId = parentId || undefined;
    }

    recountCategories();
    audit(db, who(req), 'category.update', `category:${cat.id}`, { before, after: cat });
    res.json({ category: cat, message: `"${cat.name}" updated.` });
  });

  r.delete('/directory/categories/:id', (req, res) => {
    const cat = db.categories.find((c) => c.id === req.params.id);
    if (!cat) return notFound(res, 'Category');
    const actor = who(req);

    const children = db.categories.filter((c) => c.parentId === cat.id);
    const products = db.products.filter((p) => p.categoryId === cat.id);
    const orgs = db.orgs.filter((o) => o.categories.includes(cat.id));

    if (children.length || products.length) {
      return res.status(409).json({
        error: 'has_references',
        message: `"${cat.name}" still holds ${products.length} product(s) and ${children.length} sub-categor${children.length === 1 ? 'y' : 'ies'}. Move or re-categorise them before deleting.`,
        products: products.length,
        children: children.length,
        remedy: 'move_products',
      });
    }
    if (orgs.length) {
      // An org pointing at a missing category is a silent broken filter, so the
      // reference is dropped here rather than left dangling.
      for (const o of orgs) o.categories = o.categories.filter((c) => c !== cat.id);
    }

    db.categories = db.categories.filter((c) => c.id !== cat.id);
    recountCategories();
    logActivity(db, actor, 'category.deleted', 'category', cat.id, cat.name);
    audit(db, actor, 'category.delete', `category:${cat.id}`, { name: cat.name, orgsDetached: orgs.length });
    res.json({
      ok: true,
      message: `"${cat.name}" deleted.${orgs.length ? ` ${orgs.length} seller categor${orgs.length === 1 ? 'y was' : 'ies were'} updated.` : ''}`,
    });
  });

  return r;
}
