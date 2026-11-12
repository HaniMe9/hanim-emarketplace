import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Boxes, CheckCircle2, Package, Pause, Plus, Search as SearchIcon, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, moneyShort } from '../../lib/format.ts';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Input, Notice, Select, Spinner, StatusBadge, Tabs, Textarea,
} from '../../components/ui.tsx';
import type { Offer, Product, ProductCondition, Fulfillment } from '../../../shared/types.ts';

type Listing = Offer & {
  product: Product;
  isBuyBox: boolean;
  competitorCount: number;
  revenue30d: number;
  unitsSold30d: number;
};

const TABS = [
  { id: '', label: 'All' },
  { id: 'live', label: 'Live' },
  { id: 'pending_review', label: 'In review' },
  { id: 'paused', label: 'Paused' },
  { id: 'rejected', label: 'Rejected' },
  { id: 'draft', label: 'Drafts' },
];

export function SellerListings() {
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, error, reload, setData } = useQuery<{ items: Listing[]; counts: Record<string, number> }>(
    `/seller/listings${tab ? `?status=${tab}` : ''}`,
  );
  const [showNew, setShowNew] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [editing, setEditing] = useState<Listing | null>(null);

  const items = (data?.items ?? []).filter((l) =>
    !q.trim() || l.product.title.toLowerCase().includes(q.toLowerCase()),
  );
  const stockValue = (data?.items ?? []).reduce((a, l) => a + l.price * l.stock, 0);

  async function patch(id: string, body: Record<string, unknown>, ok: string) {
    setBusy(id);
    setErr(null);
    try {
      await api.patch(`/seller/listings/${id}`, body);
      setMsg(ok);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update that listing.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Loading listings…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Listings</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {data?.counts.live ?? 0} live · {data?.counts.pending_review ?? 0} awaiting review · stock worth{' '}
            {moneyShort(stockValue)}
          </p>
        </div>
        <div className="flex w-full items-center gap-2 sm:w-auto">
          <div className="relative flex-1 sm:w-56">
            <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
            <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search your listings" className="h-9 pl-9 text-xs" />
          </div>
          <Button variant="primary" onClick={() => setShowNew(true)} icon={<Plus className="size-4" />}>
            New listing
          </Button>
        </div>
      </div>

      <Tabs tabs={TABS.map((t) => ({ id: t.id, label: t.label, count: t.id ? data?.counts[t.id] : data?.counts.all }))} value={tab} onChange={setTab} />

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {showNew && (
        <NewListingForm
          onDone={(created) => {
            setShowNew(false);
            setMsg(`"${created}" submitted. It goes live after the moderation check — usually within a few hours.`);
            setData((d) => (d ? { ...d, counts: { ...d.counts, all: d.counts.all + 1, pending_review: d.counts.pending_review + 1 } } : d));
            reload();
          }}
          onClose={() => setShowNew(false)}
        />
      )}

      {items.length === 0 ? (
        <Empty icon={<Boxes className="size-5" />} title="Nothing listed here" message="Create a listing and it will appear in this table." />
      ) : (
        <div className="space-y-2">
          {items.map((l) => (
            <Card key={l.id} className={clsx('p-3', l.status !== 'live' && 'opacity-90')}>
              <div className="flex flex-wrap items-center gap-3">
                <img src={l.product.images[0]} alt="" className="size-14 shrink-0 rounded-md border border-line object-cover" />

                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-1.5">
                    <Link to={`/product/${l.product.slug}`} className="text-sm font-semibold hover:text-brand">
                      {l.product.title}
                    </Link>
                    <StatusBadge status={l.status} />
                    {l.isBuyBox && <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Buy Box</Badge>}
                    {l.promoted && <Badge tone="gold" icon={<Zap className="size-3" />}>Sponsored</Badge>}
                  </p>
                  <p className="mt-0.5 flex flex-wrap gap-x-2.5 text-[11px] text-ink-3">
                    <span className="font-semibold text-ink">{birr(l.price)}</span>
                    {l.compareAtPrice && <span className="line-through">{birr(l.compareAtPrice)}</span>}
                    <span>· {l.stock} in stock</span>
                    <span>· {l.competitorCount} competitor{l.competitorCount === 1 ? '' : 's'}</span>
                    <span>· {l.unitsSold30d} sold in 30d</span>
                    <span>· {moneyShort(l.revenue30d)}</span>
                  </p>
                  {l.stock <= 5 && (
                    <p className="mt-1 flex items-center gap-1 text-[10px] font-semibold text-bad">
                      <AlertTriangle className="size-3" /> Low stock. Stockouts lose your Buy Box eligibility.
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-1.5">
                  <Button size="sm" variant="secondary" onClick={() => setEditing(editing?.id === l.id ? null : l)}>
                    Edit
                  </Button>
                  {l.status === 'live' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === l.id}
                      onClick={() => void patch(l.id, { status: 'paused' }, `${l.product.title} paused. It disappears from search immediately.`)}
                      icon={<Pause className="size-3.5" />}
                    >
                      Pause
                    </Button>
                  )}
                  {l.status === 'paused' && (
                    <Button
                      size="sm"
                      variant="ghost"
                      loading={busy === l.id}
                      onClick={() => void patch(l.id, { status: 'live' }, `${l.product.title} is live again.`)}
                    >
                      Resume
                    </Button>
                  )}
                </div>
              </div>

              {editing?.id === l.id && (
                <EditForm
                  listing={l}
                  onClose={() => setEditing(null)}
                  onSave={(body, ok) => {
                    setEditing(null);
                    void patch(l.id, body, ok);
                  }}
                />
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function EditForm({
  listing,
  onClose,
  onSave,
}: {
  listing: Listing;
  onClose: () => void;
  onSave: (body: Record<string, unknown>, ok: string) => void;
}) {
  const [price, setPrice] = useState(String(listing.price / 100));
  const [stock, setStock] = useState(String(listing.stock));
  const [warranty, setWarranty] = useState(listing.warranty ?? '');

  return (
    <form
      className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-3"
      onSubmit={(e) => {
        e.preventDefault();
        onSave(
          { price: Math.round(Number(price) * 100), stock: Number(stock), warranty: warranty.trim() || undefined },
          `Listing updated. Price changes take effect on the next impression.`,
        );
      }}
    >
      <Field label="Price (ETB)" required>
        <Input type="number" step="0.01" min="0" value={price} onChange={(e) => setPrice(e.target.value)} required />
      </Field>
      <Field label="Stock" required hint="Keep this honest. Stockouts remove Buy Box eligibility.">
        <Input type="number" min="0" value={stock} onChange={(e) => setStock(e.target.value)} required />
      </Field>
      <Field label="Warranty">
        <Input value={warranty} onChange={(e) => setWarranty(e.target.value)} placeholder="12 months manufacturer" />
      </Field>
      <div className="flex gap-2 sm:col-span-3">
        <Button size="sm" type="submit" variant="primary">Save changes</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose}>Cancel</Button>
      </div>
    </form>
  );
}

function NewListingForm({ onDone, onClose }: { onDone: (title: string) => void; onClose: () => void }) {
  const [form, setForm] = useState<{
    title: string; categoryId: string; price: string; stock: string;
    condition: ProductCondition; fulfillment: Fulfillment; description: string; moq: string;
  }>({
    title: '',
    categoryId: 'cat_electronics',
    price: '',
    stock: '',
    condition: 'new',
    fulfillment: 'seller_fulfilled' as Fulfillment,
    description: '',
    moq: '',
  });
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  function set<K extends keyof typeof form>(k: K, v: (typeof form)[K]) {
    setForm((f) => ({ ...f, [k]: v }));
  }

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      await api.post('/seller/listings', {
        title: form.title.trim(),
        categoryId: form.categoryId,
        price: Math.round(Number(form.price) * 100),
        stock: Number(form.stock),
        condition: form.condition,
        fulfillment: form.fulfillment,
        description: form.description.trim(),
        moq: form.moq ? Number(form.moq) : null,
      });
      onDone(form.title.trim());
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not create that listing.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-rise border-brand/30">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
        <Package className="size-4 text-brand" /> New listing
      </p>
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}
      <form onSubmit={submit} className="grid gap-3 sm:grid-cols-2">
        <Field className="sm:col-span-2" label="Title" required>
          <Input value={form.title} onChange={(e) => set('title', e.target.value)} required minLength={6} placeholder="Samsung Galaxy A55 5G — 128GB, 8GB RAM" />
        </Field>
        <Field label="Category" required>
          <Select value={form.categoryId} onChange={(e) => set('categoryId', e.target.value)}>
            <option value="cat_electronics">Electronics</option>
            <option value="cat_phones">Phones</option>
            <option value="cat_home">Home & Kitchen</option>
            <option value="cat_fashion">Fashion</option>
            <option value="cat_beauty">Beauty</option>
            <option value="cat_coffee">Coffee & Tea</option>
            <option value="cat_sports">Sports</option>
          </Select>
        </Field>
        <Field label="Condition" required>
          <Select value={form.condition} onChange={(e) => set('condition', e.target.value as ProductCondition)}>
            <option value="new">New</option>
            <option value="like_new">Like new</option>
            <option value="refurbished">Refurbished</option>
            <option value="used">Used</option>
          </Select>
        </Field>
        <Field label="Price (ETB)" required>
          <Input type="number" step="0.01" min="1" value={form.price} onChange={(e) => set('price', e.target.value)} required />
        </Field>
        <Field label="Stock" required>
          <Input type="number" min="1" value={form.stock} onChange={(e) => set('stock', e.target.value)} required />
        </Field>
        <Field label="Fulfilment" required>
          <Select value={form.fulfillment} onChange={(e) => set('fulfillment', e.target.value as Fulfillment)}>
            <option value="seller_fulfilled">You ship it</option>
            <option value="fba">HaniMarket warehouse</option>
            <option value="pickup">Buyer collects</option>
          </Select>
        </Field>
        <Field label="Minimum order quantity" hint="Leave blank for retail only. Setting this enables wholesale pricing.">
          <Input type="number" min="1" value={form.moq} onChange={(e) => set('moq', e.target.value)} placeholder="Optional" />
        </Field>
        <Field className="sm:col-span-2" label="Description" required>
          <Textarea rows={4} value={form.description} onChange={(e) => set('description', e.target.value)} required minLength={20}
            placeholder="What it is, what it does, what is in the box, and what a buyer should know before ordering." />
        </Field>
        <div className="flex gap-2 sm:col-span-2">
          <Button type="submit" variant="primary" loading={busy}>Submit for review</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
      <Notice tone="info" className="mt-3">
        New listings go through a moderation check before going live. Nothing you write can mark a listing as
        sponsored — that is bought separately and always labelled.
      </Notice>
    </Card>
  );
}
