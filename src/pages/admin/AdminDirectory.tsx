import { useState } from 'react';
import {
  Ban, Building2, CheckCircle2, FolderTree, Pencil, Plus, RotateCcw, Search as SearchIcon, Trash2, TriangleAlert, UserPlus, Users,
} from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError, qs } from '../../lib/api.ts';
import { ago, num } from '../../lib/format.ts';
import { t } from '../../lib/i18n/index.ts';
import { ROLE_LABEL_KEY } from '../../lib/session.tsx';
import {
  Avatar, Badge, Button, Card, Empty, ErrorNote, Field, Grid, Input, Notice, Select, Spinner, Stat, Tabs, Textarea,
} from '../../components/ui.tsx';
import type { Category, Organization, Role, User, VerificationTier } from '../../../shared/types.ts';

type Ref = { kind: string; count: number };

type UserRow = User & { orgName: string | null; orders: number; listings: number; references: Ref[] };
type UsersResponse = { items: UserRow[]; counts: { total: number; active: number; suspended: number; byRole: Record<string, number> } };

type SellerRow = Organization & { listingCount: number; liveListings: number; orderCount: number; memberCount: number; references: Ref[] };
type SellersResponse = { items: SellerRow[]; counts: { total: number; sellers: number; buyerOrgs: number; suspended: number } };

type CatRow = Category & { children: Category[]; orgCount: number; references: number };
type CatsResponse = { items: CatRow[]; counts: { total: number; roots: number; children: number; empty: number } };

const ROLES: Role[] = ['buyer', 'business_buyer', 'seller', 'agent', 'admin'];
const TIERS: VerificationTier[] = ['none', 'basic', 'business', 'trusted', 'enterprise'];

const PLURAL: Record<string, string> = { 'ledger entry': 'ledger entries', 'payout account': 'payout accounts' };
const refLabel = (kind: string, count: number) => `${count} ${count === 1 ? kind : (PLURAL[kind] ?? `${kind}s`)}`;

/** Shared feedback banner state so every action in the page reports the same way. */
function useFeedback() {
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  return { msg, err, setMsg, setErr, clear: () => { setMsg(null); setErr(null); } };
}

function RefBadges({ refs }: { refs: Ref[] }) {
  if (!refs.length) return null;
  return (
    <p className="mt-1.5 flex flex-wrap items-center gap-1">
      {refs.map((r) => (
        <Badge key={r.kind} tone="warn">{refLabel(r.kind, r.count)}</Badge>
      ))}
    </p>
  );
}

export function AdminDirectory() {
  const [tab, setTab] = useState<'users' | 'sellers' | 'categories'>('users');
  // Categories are needed by the category tree and by the seller's category
  // picker, so they are fetched once here and only when a tab actually uses them.
  const cats = useQuery<CatsResponse>(tab === 'categories' || tab === 'sellers' ? '/admin/directory/categories' : null);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Directory</h1>
        <p className="mt-0.5 text-xs text-ink-3">
          People, sellers and categories. Every change here is written to the audit log with your name on it.
        </p>
      </div>

      <Tabs
        tabs={[
          { id: 'users', label: 'Users' },
          { id: 'sellers', label: 'Sellers' },
          { id: 'categories', label: 'Categories' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'users' && <UsersTab />}
      {tab === 'sellers' && <SellersTab cats={cats} />}
      {tab === 'categories' && <CategoriesTab cats={cats} />}
    </div>
  );
}

/* -------------------------------- users --------------------------------- */

function UsersTab() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const [status, setStatus] = useState('');
  const { data, loading, error, reload } = useQuery<UsersResponse>(
    `/admin/directory/users${qs({ q, role, status })}`,
  );
  const fb = useFeedback();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string; refs: Ref[] } | null>(null);

  async function suspend(u: UserRow, suspended: boolean) {
    fb.clear();
    const reason = suspended
      ? window.prompt(`Why is ${u.name} being suspended? The reason is shown to the user and stored in the audit log.`)
      : window.prompt(`Reinstate ${u.name}? Add a note for the audit log.`);
    if (reason === null) return;
    if (suspended && !reason.trim()) {
      fb.setErr('A suspension needs a written reason.');
      return;
    }
    try {
      const r = await api.post<{ message: string }>(`/admin/directory/users/${u.id}/suspend`, { reason: reason.trim(), suspended });
      fb.setMsg(r.message);
      reload();
    } catch (e) {
      fb.setErr(e instanceof ApiError ? e.message : 'Could not change that account.');
    }
  }

  async function destroy(u: UserRow) {
    fb.clear();
    try {
      const r = await api.del<{ message: string }>(`/admin/directory/users/${u.id}`);
      fb.setMsg(r.message);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_references') {
        // The API refuses rather than cascading, so the row stays and the
        // reason is shown next to it.
        const refs = (e.body.references as Ref[] | undefined) ?? [];
        setPending({ id: u.id, name: u.name, refs });
        fb.setErr(e.message);
        return;
      }
      fb.setErr(e instanceof ApiError ? e.message : 'Could not delete that account.');
    }
  }

  if (loading) return <Spinner label="Loading users…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <Grid cols={4}>
        <Stat label="Accounts" value={num(data?.counts.total)} />
        <Stat label="Active" value={num(data?.counts.active)} tone="ok" icon={<CheckCircle2 className="size-4" />} />
        <Stat label="Suspended" value={num(data?.counts.suspended)} tone={data?.counts.suspended ? 'bad' : 'muted'} icon={<Ban className="size-4" />} />
        <Stat label="Admins" value={num(data?.counts.byRole.admin)} tone="brand" />
      </Grid>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search name, email or phone" className="h-9 pl-9 text-xs" />
        </div>
        <Select value={role} onChange={(e) => setRole(e.target.value)} className="h-9 w-40 text-xs">
          <option value="">All roles</option>
          {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>)}
        </Select>
        <Select value={status} onChange={(e) => setStatus(e.target.value)} className="h-9 w-36 text-xs">
          <option value="">Any status</option>
          <option value="active">Active</option>
          <option value="suspended">Suspended</option>
        </Select>
        <Button variant="primary" onClick={() => { fb.clear(); setCreating((v) => !v); }} icon={<UserPlus className="size-4" />}>
          New user
        </Button>
      </div>

      {fb.msg && <Notice tone="ok" onClose={fb.clear}>{fb.msg}</Notice>}
      {fb.err && <ErrorNote message={fb.err} />}

      {creating && (
        <UserForm
          onClose={() => setCreating(false)}
          onDone={(m) => { setCreating(false); fb.setMsg(m); reload(); }}
          onError={fb.setErr}
        />
      )}

      {items.length === 0 ? (
        <Empty icon={<Users className="size-5" />} title="No accounts match" message="Clear the filters, or create a new account." />
      ) : (
        <div className="space-y-2">
          {items.map((u) => (
            <Card key={u.id} className={clsx('p-3', u.suspended && 'border-bad/30 bg-bad-soft/20')}>
              <div className="flex flex-wrap items-center gap-3">
                <Avatar name={u.name} hue={u.avatarHue} size={36} />
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{u.name}</span>
                    <Badge tone={u.role === 'admin' ? 'brand' : 'muted'}>{t(ROLE_LABEL_KEY[u.role])}</Badge>
                    {u.suspended && <Badge tone="bad" icon={<Ban className="size-3" />}>Suspended</Badge>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-ink-3">
                    <span>{u.email}</span>
                    <span>· {u.phone}</span>
                    {u.orgName && <span>· {u.orgName}</span>}
                    <span>· joined {ago(u.createdAt)}</span>
                  </p>
                  {u.suspended && u.suspendedReason && (
                    <p className="mt-1 text-[11px] font-semibold text-bad">Reason: {u.suspendedReason}</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => { fb.clear(); setEditing(editing === u.id ? null : u.id); }} icon={<Pencil className="size-3.5" />}>
                    Edit
                  </Button>
                  {u.suspended ? (
                    <Button size="sm" variant="ghost" onClick={() => void suspend(u, false)} icon={<RotateCcw className="size-3.5" />}>
                      Reinstate
                    </Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void suspend(u, true)} icon={<Ban className="size-3.5" />}>
                      Suspend
                    </Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => void destroy(u)} icon={<Trash2 className="size-3.5" />}>
                    Delete
                  </Button>
                </div>
              </div>

              <RefBadges refs={u.references} />

              {pending?.id === u.id && (
                <Notice tone="warn" className="mt-2" onClose={() => setPending(null)} title="Suspend instead of delete">
                  Suspending keeps every order, review and ledger line intact and only blocks sign-in. Deleting is
                  refused for as long as those references exist, because a payout or a dispute still points at this account.
                </Notice>
              )}

              {editing === u.id && (
                <UserForm
                  user={u}
                  onClose={() => setEditing(null)}
                  onDone={(m) => { setEditing(null); fb.setMsg(m); reload(); }}
                  onError={fb.setErr}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function UserForm({
  user,
  onClose,
  onDone,
  onError,
}: {
  user?: UserRow;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const editing = Boolean(user);
  const [form, setForm] = useState({
    name: user?.name ?? '',
    email: user?.email ?? '',
    phone: user?.phone ?? '',
    role: (user?.role ?? 'buyer') as Role,
    city: user?.city ?? 'Addis Ababa',
    password: '',
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      if (editing) {
        const body: Record<string, unknown> = {
          name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          role: form.role, city: form.city.trim(),
        };
        if (form.password) body.password = form.password;
        const r = await api.patch<{ message: string }>(`/admin/directory/users/${user!.id}`, body);
        onDone(r.message);
      } else {
        const r = await api.post<{ message: string }>('/admin/directory/users', {
          name: form.name.trim(), email: form.email.trim(), phone: form.phone.trim(),
          role: form.role, city: form.city.trim(), password: form.password,
        });
        onDone(r.message);
      }
    } catch (e2) {
      onError(e2 instanceof ApiError ? e2.message : 'Could not save that account.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-rise mt-3 border-brand/30">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
        {editing ? <Pencil className="size-4 text-brand" /> : <UserPlus className="size-4 text-brand" />}
        {editing ? `Edit ${user!.name}` : 'New user'}
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Full name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} required minLength={2} />
        </Field>
        <Field label="Email" required>
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} required />
        </Field>
        <Field label="Phone" required hint="Ethiopian format, e.g. +251911000111">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} required placeholder="+251…" />
        </Field>
        <Field label="Role" required>
          <Select value={form.role} onChange={(e) => set('role', e.target.value as Role)}>
            {ROLES.map((r) => <option key={r} value={r}>{t(ROLE_LABEL_KEY[r])}</option>)}
          </Select>
        </Field>
        <Field label="City">
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} />
        </Field>
        <Field label="Password" hint={editing ? 'Leave blank to keep the current password' : 'At least 8 characters'}>
          <Input type="password" value={form.password} onChange={(e) => set('password', e.target.value)} minLength={editing ? 0 : 8} autoComplete="new-password" />
        </Field>
        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" variant="primary" loading={busy}>{editing ? 'Save changes' : 'Create user'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
      <Notice tone="info" className="mt-3">
        A new account starts with no verification, no listings and no tier badge. Granting those is a separate,
        audited decision on the Moderation page.
      </Notice>
    </Card>
  );
}

/* -------------------------------- sellers -------------------------------- */

function SellersTab({ cats }: { cats: ReturnType<typeof useQuery<CatsResponse>> }) {
  const [q, setQ] = useState('');
  const [type, setType] = useState('');
  const { data, loading, error, reload } = useQuery<SellersResponse>(`/admin/directory/sellers${qs({ q, type })}`);
  const fb = useFeedback();
  const [creating, setCreating] = useState(false);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState<{ id: string; name: string; refs: Ref[] } | null>(null);

  const allCats = cats.data?.items ?? [];

  async function suspend(o: SellerRow, suspended: boolean) {
    fb.clear();
    const reason = suspended
      ? window.prompt(`Why is ${o.name} being suspended? Buyers see this on the storefront.`)
      : window.prompt(`Reinstate ${o.name}? Add a note for the audit log.`);
    if (reason === null) return;
    if (suspended && !reason.trim()) {
      fb.setErr('A suspension needs a written reason.');
      return;
    }
    try {
      const r = await api.post<{ message: string }>(`/admin/directory/sellers/${o.id}/suspend`, { reason: reason.trim(), suspended });
      fb.setMsg(r.message);
      reload();
    } catch (e) {
      fb.setErr(e instanceof ApiError ? e.message : 'Could not change that seller.');
    }
  }

  async function destroy(o: SellerRow) {
    fb.clear();
    try {
      const r = await api.del<{ message: string }>(`/admin/directory/sellers/${o.id}`);
      fb.setMsg(r.message);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_references') {
        setPending({ id: o.id, name: o.name, refs: (e.body.references as Ref[] | undefined) ?? [] });
        fb.setErr(e.message);
        return;
      }
      fb.setErr(e instanceof ApiError ? e.message : 'Could not delete that seller.');
    }
  }

  if (loading) return <Spinner label="Loading sellers…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const items = data?.items ?? [];

  return (
    <div className="space-y-4">
      <Grid cols={4}>
        <Stat label="Organisations" value={num(data?.counts.total)} />
        <Stat label="Sellers" value={num(data?.counts.sellers)} tone="brand" icon={<Building2 className="size-4" />} />
        <Stat label="Buyer orgs" value={num(data?.counts.buyerOrgs)} />
        <Stat label="Suspended" value={num(data?.counts.suspended)} tone={data?.counts.suspended ? 'bad' : 'muted'} icon={<Ban className="size-4" />} />
      </Grid>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search seller or city" className="h-9 pl-9 text-xs" />
        </div>
        <Select value={type} onChange={(e) => setType(e.target.value)} className="h-9 w-40 text-xs">
          <option value="">All types</option>
          <option value="seller">Seller</option>
          <option value="buyer_org">Buyer organisation</option>
        </Select>
        <Button variant="primary" onClick={() => { fb.clear(); setCreating((v) => !v); }} icon={<Plus className="size-4" />}>
          New organisation
        </Button>
      </div>

      {fb.msg && <Notice tone="ok" onClose={fb.clear}>{fb.msg}</Notice>}
      {fb.err && <ErrorNote message={fb.err} />}

      {creating && (
        <SellerForm
          cats={allCats}
          onClose={() => setCreating(false)}
          onDone={(m) => { setCreating(false); fb.setMsg(m); reload(); }}
          onError={fb.setErr}
        />
      )}

      {items.length === 0 ? (
        <Empty icon={<Building2 className="size-5" />} title="No organisations match" message="Clear the filters, or create a new one." />
      ) : (
        <div className="space-y-2">
          {items.map((o) => (
            <Card key={o.id} className={clsx('p-3', o.suspended && 'border-bad/30 bg-bad-soft/20')}>
              <div className="flex flex-wrap items-center gap-3">
                <span
                  className="flex size-9 shrink-0 items-center justify-center rounded-lg text-xs font-bold text-white"
                  style={{ background: `linear-gradient(135deg, oklch(58% 0.12 ${o.hue}), oklch(46% 0.1 ${o.hue + 30}))` }}
                >
                  {o.logoText}
                </span>
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <span className="text-sm font-semibold">{o.name}</span>
                    <Badge tone={o.type === 'seller' ? 'brand' : 'violet'}>{o.type === 'seller' ? 'Seller' : 'Buyer org'}</Badge>
                    <Badge tone={o.tier === 'none' ? 'muted' : 'ok'}>{o.tier}</Badge>
                    {o.published && <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Published</Badge>}
                    {o.suspended && <Badge tone="bad" icon={<Ban className="size-3" />}>Suspended</Badge>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-ink-3">
                    <span>{o.city}</span>
                    <span>· {o.listingCount} listings ({o.liveListings} live)</span>
                    <span>· {o.orderCount} orders</span>
                    <span>· {o.memberCount} member(s)</span>
                  </p>
                  {o.suspended && (
                    <p className="mt-1 text-[11px] text-ink-3">Storefront hidden. Orders already in delivery still complete.</p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => { fb.clear(); setEditing(editing === o.id ? null : o.id); }} icon={<Pencil className="size-3.5" />}>
                    Edit
                  </Button>
                  {o.suspended ? (
                    <Button size="sm" variant="ghost" onClick={() => void suspend(o, false)} icon={<RotateCcw className="size-3.5" />}>Reinstate</Button>
                  ) : (
                    <Button size="sm" variant="ghost" onClick={() => void suspend(o, true)} icon={<Ban className="size-3.5" />}>Suspend</Button>
                  )}
                  <Button size="sm" variant="danger" onClick={() => void destroy(o)} icon={<Trash2 className="size-3.5" />}>Delete</Button>
                </div>
              </div>

              <RefBadges refs={o.references} />

              {pending?.id === o.id && (
                <Notice tone="warn" className="mt-2" onClose={() => setPending(null)} title="Suspend instead of delete">
                  Orders, payouts and ledger lines still point at this seller. Suspend takes the storefront offline and
                  pauses its listings while leaving the financial history that has to reconcile against.
                </Notice>
              )}

              {editing === o.id && (
                <SellerForm
                  org={o}
                  cats={allCats}
                  onClose={() => setEditing(null)}
                  onDone={(m) => { setEditing(null); fb.setMsg(m); reload(); cats.reload(); }}
                  onError={fb.setErr}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function SellerForm({
  org,
  cats,
  onClose,
  onDone,
  onError,
}: {
  org?: SellerRow;
  cats: CatRow[];
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const editing = Boolean(org);
  const [form, setForm] = useState({
    name: org?.name ?? '',
    nameAm: org?.nameAm ?? '',
    city: org?.city ?? '',
    region: org?.region ?? '',
    phone: org?.phone ?? '',
    email: org?.email ?? '',
    type: (org?.type ?? 'seller') as 'seller' | 'buyer_org',
    tier: (org?.tier ?? 'none') as VerificationTier,
    description: org?.description ?? '',
    categories: org?.categories ?? [],
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  function toggleCat(id: string) {
    setForm((f) => ({
      ...f,
      categories: f.categories.includes(id) ? f.categories.filter((c) => c !== id) : [...f.categories, id],
    }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    try {
      if (editing) {
        const r = await api.patch<{ message: string }>(`/admin/directory/sellers/${org!.id}`, {
          name: form.name.trim(), nameAm: form.nameAm.trim(), city: form.city.trim(),
          region: form.region.trim(), phone: form.phone.trim(), email: form.email.trim(),
          tier: form.tier, description: form.description.trim(), categories: form.categories,
        });
        onDone(r.message);
      } else {
        const r = await api.post<{ message: string }>('/admin/directory/sellers', {
          name: form.name.trim(), nameAm: form.nameAm.trim(), city: form.city.trim(),
          region: form.region.trim(), phone: form.phone.trim(), email: form.email.trim(),
          type: form.type, description: form.description.trim(), categories: form.categories,
        });
        onDone(r.message);
      }
    } catch (e2) {
      onError(e2 instanceof ApiError ? e2.message : 'Could not save that organisation.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-rise mt-3 border-brand/30">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
        {editing ? <Pencil className="size-4 text-brand" /> : <Plus className="size-4 text-brand" />}
        {editing ? `Edit ${org!.name}` : 'New organisation'}
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-3">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} required minLength={2} />
        </Field>
        <Field label="Name (Amharic)" hint="Optional. Shown when the interface is in Amharic.">
          <Input value={form.nameAm} onChange={(e) => set('nameAm', e.target.value)} />
        </Field>
        <Field label="Type" required>
          <Select value={form.type} onChange={(e) => set('type', e.target.value as 'seller' | 'buyer_org')}>
            <option value="seller">Seller</option>
            <option value="buyer_org">Buyer organisation</option>
          </Select>
        </Field>
        <Field label="City" required>
          <Input value={form.city} onChange={(e) => set('city', e.target.value)} required />
        </Field>
        <Field label="Region">
          <Input value={form.region} onChange={(e) => set('region', e.target.value)} />
        </Field>
        <Field label="Verification tier" required hint={editing ? 'Raising a tier publishes the storefront.' : 'A new organisation always starts unverified.'}>
          <Select value={form.tier} onChange={(e) => set('tier', e.target.value as VerificationTier)} disabled={!editing}>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </Select>
        </Field>
        <Field label="Phone">
          <Input value={form.phone} onChange={(e) => set('phone', e.target.value)} />
        </Field>
        <Field label="Email">
          <Input type="email" value={form.email} onChange={(e) => set('email', e.target.value)} />
        </Field>
        <Field className="sm:col-span-3" label="Description">
          <Textarea rows={2} value={form.description} onChange={(e) => set('description', e.target.value)} />
        </Field>

        <div className="sm:col-span-3">
          <p className="mb-1.5 text-xs font-semibold text-ink-2">Categories this seller trades in</p>
          {cats.length === 0 ? (
            <p className="text-[11px] text-ink-3">Loading categories…</p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {cats.map((c) => (
                <button
                  key={c.id}
                  type="button"
                  onClick={() => toggleCat(c.id)}
                  className={clsx(
                    'rounded-full border px-2.5 py-1 text-[11px] font-semibold transition-colors',
                    form.categories.includes(c.id) ? 'border-brand bg-brand-soft text-brand-ink' : 'border-line text-ink-3 hover:bg-surface-2',
                  )}
                >
                  {c.name}
                </button>
              ))}
            </div>
          )}
        </div>

        <div className="flex gap-2 sm:col-span-3">
          <Button type="submit" variant="primary" loading={busy}>{editing ? 'Save changes' : 'Create organisation'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
      <Notice tone="warn" className="mt-3" title="Tier is a trust decision, not a form field">
        Approving a verification case is the normal route to a higher tier. Editing it here bypasses the document
        checks, and the change is recorded in the audit log under your name.
      </Notice>
    </Card>
  );
}

/* ------------------------------- categories ------------------------------ */

function CategoriesTab({ cats }: { cats: ReturnType<typeof useQuery<CatsResponse>> }) {
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useQuery<CatsResponse>(`/admin/directory/categories${qs({ q })}`);
  const fb = useFeedback();
  const [creating, setCreating] = useState<{ parentId?: string } | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<{ id: string; name: string; products: number; children: number } | null>(null);

  async function destroy(c: CatRow) {
    fb.clear();
    try {
      const r = await api.del<{ message: string }>(`/admin/directory/categories/${c.id}`);
      fb.setMsg(r.message);
      reload();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'has_references') {
        setBlocked({
          id: c.id,
          name: c.name,
          products: Number(e.body.products ?? 0),
          children: Number(e.body.children ?? 0),
        });
        fb.setErr(e.message);
        return;
      }
      fb.setErr(e instanceof ApiError ? e.message : 'Could not delete that category.');
    }
  }

  if (loading || cats.loading) return <Spinner label="Loading categories…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  const roots = items.filter((c) => !c.parentId);
  const orphans = items.filter((c) => c.parentId && !roots.some((r) => r.id === c.parentId));
  const shown = [...roots, ...orphans];

  return (
    <div className="space-y-4">
      <Grid cols={4}>
        <Stat label="Categories" value={num(data?.counts.total)} icon={<FolderTree className="size-4" />} />
        <Stat label="Top level" value={num(data?.counts.roots)} />
        <Stat label="Sub-categories" value={num(data?.counts.children)} />
        <Stat label="Empty" value={num(data?.counts.empty)} tone={data?.counts.empty ? 'warn' : 'muted'} />
      </Grid>

      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-48 flex-1">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search categories" className="h-9 pl-9 text-xs" />
        </div>
        <Button variant="primary" onClick={() => { fb.clear(); setCreating({}); }} icon={<Plus className="size-4" />}>
          New category
        </Button>
      </div>

      {fb.msg && <Notice tone="ok" onClose={fb.clear}>{fb.msg}</Notice>}
      {fb.err && <ErrorNote message={fb.err} />}

      {creating && (
        <CategoryForm
          parentId={creating.parentId}
          onClose={() => setCreating(null)}
          onDone={(m) => { setCreating(null); fb.setMsg(m); reload(); cats.reload(); }}
          onError={fb.setErr}
        />
      )}

      {shown.length === 0 ? (
        <Empty icon={<FolderTree className="size-5" />} title="No categories" message="Create the first one." />
      ) : (
        <div className="space-y-2">
          {shown.map((root) => (
            <Card key={root.id} className="p-3">
              <CategoryRow
                cat={root}
                depth={0}
                editing={editing === root.id}
                onEdit={() => { fb.clear(); setEditing(editing === root.id ? null : root.id); }}
                onAddChild={() => { fb.clear(); setCreating({ parentId: root.id }); }}
                onDelete={() => void destroy(root)}
                onDone={(m) => { setEditing(null); fb.setMsg(m); reload(); cats.reload(); }}
                onError={fb.setErr}
              />
              {blocked?.id === root.id && (
                <Notice tone="warn" className="mt-2" onClose={() => setBlocked(null)} title="Move the products first">
                  {blocked.products} product(s) and {blocked.children} sub-categor{blocked.children === 1 ? 'y' : 'ies'} still
                  sit under “{blocked.name}”. A category cannot be deleted out from under its products.
                </Notice>
              )}
              {items
                .filter((c) => c.parentId === root.id)
                .map((child) => (
                  <div key={child.id} className="mt-2 ml-4 border-l border-line pl-3">
                    <CategoryRow
                      cat={child}
                      depth={1}
                      editing={editing === child.id}
                      onEdit={() => { fb.clear(); setEditing(editing === child.id ? null : child.id); }}
                      onDelete={() => void destroy(child)}
                      onDone={(m) => { setEditing(null); fb.setMsg(m); reload(); cats.reload(); }}
                      onError={fb.setErr}
                    />
                    {blocked?.id === child.id && (
                      <Notice tone="warn" className="mt-2" onClose={() => setBlocked(null)} title="Move the products first">
                        {blocked.products} product(s) still sit under “{blocked.name}”. Re-categorise them before deleting.
                      </Notice>
                    )}
                  </div>
                ))}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function CategoryRow({
  cat,
  depth,
  editing,
  onEdit,
  onAddChild,
  onDelete,
  onDone,
  onError,
}: {
  cat: CatRow;
  depth: number;
  editing: boolean;
  onEdit: () => void;
  onAddChild?: () => void;
  onDelete: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  return (
    <div className={clsx(depth > 0 && 'py-1')}>
      <div className="flex flex-wrap items-center gap-3">
        <span className="size-3 shrink-0 rounded-full border border-line" style={{ background: cat.accent }} />
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <span className={clsx('font-semibold', depth === 0 ? 'text-sm' : 'text-xs')}>{cat.name}</span>
            {cat.nameAm && <span className="text-[11px] text-ink-3">{cat.nameAm}</span>}
            <Badge tone={cat.productCount ? 'ok' : 'muted'}>{cat.productCount} products</Badge>
            {cat.orgCount > 0 && <Badge tone="brand">{cat.orgCount} sellers</Badge>}
          </p>
          <p className="mt-0.5 font-mono text-[10px] text-ink-3">/{cat.slug}</p>
        </div>
        <div className="flex shrink-0 items-center gap-1.5">
          <Button size="sm" variant="secondary" onClick={onEdit} icon={<Pencil className="size-3.5" />}>Edit</Button>
          {onAddChild && (
            <Button size="sm" variant="ghost" onClick={onAddChild} icon={<Plus className="size-3.5" />}>Sub</Button>
          )}
          <Button size="sm" variant="danger" onClick={onDelete} icon={<Trash2 className="size-3.5" />}>Delete</Button>
        </div>
      </div>
      {editing && (
        <CategoryForm
          cat={cat}
          onClose={onEdit}
          onDone={onDone}
          onError={onError}
        />
      )}
    </div>
  );
}

function CategoryForm({
  cat,
  parentId,
  onClose,
  onDone,
  onError,
}: {
  cat?: CatRow;
  parentId?: string;
  onClose: () => void;
  onDone: (message: string) => void;
  onError: (message: string) => void;
}) {
  const editing = Boolean(cat);
  const [form, setForm] = useState({
    name: cat?.name ?? '',
    nameAm: cat?.nameAm ?? '',
    blurb: cat?.blurb ?? '',
    accent: cat?.accent ?? '#0369a1',
  });
  const [busy, setBusy] = useState(false);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    onError('');
    const body = {
      name: form.name.trim(), nameAm: form.nameAm.trim(),
      blurb: form.blurb.trim(), accent: form.accent.trim(),
    };
    try {
      const r = editing
        ? await api.patch<{ message: string }>(`/admin/directory/categories/${cat!.id}`, body)
        : await api.post<{ message: string }>('/admin/directory/categories', { ...body, parentId: parentId ?? '' });
      onDone(r.message);
    } catch (e2) {
      onError(e2 instanceof ApiError ? e2.message : 'Could not save that category.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-rise mt-3 border-brand/30">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
        {editing ? <Pencil className="size-4 text-brand" /> : <FolderTree className="size-4 text-brand" />}
        {editing ? `Edit ${cat!.name}` : parentId ? 'New sub-category' : 'New category'}
      </p>
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field label="Name" required>
          <Input value={form.name} onChange={(e) => set('name', e.target.value)} required minLength={2} />
        </Field>
        <Field label="Name (Amharic)">
          <Input value={form.nameAm} onChange={(e) => set('nameAm', e.target.value)} />
        </Field>
        <Field label="Accent colour" hint="A hex colour used for the category chip.">
          <Input value={form.accent} onChange={(e) => set('accent', e.target.value)} placeholder="#0369a1" />
        </Field>
        <Field label="Blurb">
          <Input value={form.blurb} onChange={(e) => set('blurb', e.target.value)} />
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy}>{editing ? 'Save changes' : 'Create category'}</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
      {!editing && (
        <Notice tone="info" className="mt-3">
          The slug is generated from the name and must be unique, so two categories can never share a URL.
        </Notice>
      )}
      {editing && (
        <Notice tone="info" className="mt-3">
          <TriangleAlert className="mr-1 inline size-3" />
          Renaming does not change the slug, so existing product and filter links keep working.
        </Notice>
      )}
    </Card>
  );
}
