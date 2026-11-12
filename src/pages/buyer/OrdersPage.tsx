import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Package, Search as SearchIcon, Star, Truck, X } from 'lucide-react';
import { useQuery } from '../../lib/useQuery.ts';
import { birr, dateOnly } from '../../lib/format.ts';
import { Badge, Button, Card, Empty, ErrorNote, Input, Spinner, StatusBadge, Tabs, Textarea } from '../../components/ui.tsx';
import type { Order } from '../../../shared/types.ts';

const FILTERS: { id: string; label: string }[] = [
  { id: '', label: 'All' },
  { id: 'placed,confirmed,packed,shipped,out_for_delivery', label: 'In progress' },
  { id: 'delivered,completed', label: 'Delivered' },
  { id: 'cancelled,refunded,returned', label: 'Closed' },
];

export function OrdersPage() {
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useQuery<{ items: Order[]; total: number }>(
    `/orders${tab ? `?status=${tab}` : ''}`,
  );

  const items = (data?.items ?? []).filter((o) => {
    if (!q.trim()) return true;
    const needle = q.toLowerCase();
    return (
      o.code.toLowerCase().includes(needle) ||
      o.lines.some((l) => l.title.toLowerCase().includes(needle)) ||
      o.lines.some((l) => l.sellerName.toLowerCase().includes(needle))
    );
  });

  if (loading) return <Spinner label="Loading your orders…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Your orders</h1>
          <p className="mt-0.5 text-xs text-ink-3">{data?.total ?? 0} orders placed with HaniMarket</p>
        </div>
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order number or product" className="h-9 pl-9 text-xs" />
        </div>
      </div>

      <Tabs tabs={FILTERS.map((f) => ({ id: f.id, label: f.label }))} value={tab} onChange={setTab} />

      {items.length === 0 ? (
        <Empty
          icon={<Package className="size-5" />}
          title="No orders here"
          message="Once you place an order it will show up here with live delivery status."
          action={<Link to="/search"><Button variant="primary">Start shopping</Button></Link>}
        />
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <OrderRow key={o.id} order={o} />
          ))}
        </div>
      )}
    </div>
  );
}

export function OrderRow({ order: o }: { order: Order }) {
  const [cancelling, setCancelling] = useState(false);
  const [why, setWhy] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function cancel(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const res = await fetch(`/api/orders/${o.code}/cancel`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ reason: why.trim() || 'Changed my mind' }),
      });
      const body = (await res.json()) as { message?: string; error?: string };
      if (!res.ok) setErr(body.message ?? body.error ?? 'Could not cancel this order.');
      else setCancelling(false);
    } finally {
      setBusy(false);
    }
  }

  const eta = o.status === 'delivered'
    ? `Delivered ${dateOnly(o.shipment?.deliveredAt ?? o.history.at(-1)?.at)}`
    : `Arriving ${dateOnly(o.etaTo)}`;

  return (
    <Card className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line px-4 py-2.5">
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
          <Link to={`/orders/${o.code}`} className="font-mono text-xs font-bold text-brand hover:underline">
            {o.code}
          </Link>
          <span className="text-[11px] text-ink-3">{dateOnly(o.placedAt)}</span>
          <StatusBadge status={o.status} />
          {o.channel === 'b2b' && <Badge tone="violet">B2B</Badge>}
          {o.riskFlags.length > 0 && <Badge tone="warn">Risk hold</Badge>}
        </div>
        <span className="font-display text-sm font-bold">{birr(o.total)}</span>
      </div>

      <div className="flex flex-wrap items-center gap-3 p-4">
        <div className="flex -space-x-2">
          {o.lines.slice(0, 3).map((l) => (
            <Link key={l.id} to={`/product/${l.productId}`} className="rounded-md border-2 border-surface">
              <img src={l.image} alt={l.title} className="size-14 rounded-md object-cover" />
            </Link>
          ))}
          {o.lines.length > 3 && (
            <span className="flex size-14 items-center justify-center rounded-md border-2 border-surface bg-surface-2 text-[11px] font-semibold text-ink-3">
              +{o.lines.length - 3}
            </span>
          )}
        </div>
        <div className="min-w-0 flex-1">
          <p className="clamp-2 text-xs font-semibold">{o.lines.map((l) => l.title).join(', ')}</p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {o.lines.length} line{o.lines.length === 1 ? '' : 's'} ·{' '}
            {o.lines.reduce((a, l) => a + l.qty, 0)} item{o.lines.reduce((a, l) => a + l.qty, 0) === 1 ? '' : 's'} ·{' '}
            {[...new Set(o.lines.map((l) => l.sellerName))].join(', ')}
          </p>
          <p className="mt-1 flex items-center gap-1 text-[11px] text-ink-2">
            <Truck className="size-3" /> {eta}
          </p>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-line px-4 py-2.5">
        <Link to={`/orders/${o.code}`}>
          <Button size="sm" variant="secondary">View details</Button>
        </Link>
        <Link to={`/track/${o.code}`}>
          <Button size="sm" variant="ghost" icon={<Truck className="size-3.5" />}>Track</Button>
        </Link>
        {o.canReview && (
          <Link to={`/orders/${o.code}`}>
            <Button size="sm" variant="ghost" icon={<Star className="size-3.5" />}>Review</Button>
          </Link>
        )}
        {o.canCancel && !cancelling && (
          <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={() => setCancelling(true)}>
            Cancel order
          </Button>
        )}
        {o.canCancel && cancelling && (
          <form onSubmit={cancel} className="ml-auto flex items-end gap-1.5">
            <div>
              <label className="mb-1 block text-[10px] font-semibold text-ink-3">Why are you cancelling?</label>
              <Textarea rows={1} value={why} onChange={(e) => setWhy(e.target.value)} placeholder="Wrong size" className="h-8 w-40 text-xs" />
            </div>
            <Button size="sm" type="submit" variant="danger" loading={busy}>Confirm</Button>
            <Button size="sm" variant="ghost" onClick={() => setCancelling(false)} icon={<X className="size-3.5" />} />
          </form>
        )}
        {err && <p className="w-full text-[11px] text-bad">{err}</p>}
      </div>
    </Card>
  );
}
