import { useState } from 'react';
import { Package, Search as SearchIcon, Truck, X } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, dateOnly, statusLabel, titleCase } from '../../lib/format.ts';
import { Badge, Button, Card, Empty, ErrorNote, Input, Notice, Spinner, StatusBadge, Tabs, Textarea } from '../../components/ui.tsx';
import type { Order } from '../../../shared/types.ts';

type SellerOrder = Order & { sellerName: string; needsAction: boolean };

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'confirmed', label: 'To pack' },
  { id: 'packed', label: 'To ship' },
  { id: 'shipped', label: 'In transit' },
  { id: 'out_for_delivery', label: 'Out for delivery' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'disputed', label: 'Disputed' },
  { id: 'cancelled', label: 'Cancelled' },
];

export function SellerOrders() {
  const [tab, setTab] = useState('');
  const [q, setQ] = useState('');
  const { data, loading, error, reload } = useQuery<{ items: SellerOrder[]; counts: Record<string, number> }>(
    `/seller/orders${tab ? `?status=${tab}` : ''}`,
  );
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [cancelling, setCancelling] = useState<string | null>(null);
  const [cancelNote, setCancelNote] = useState('');

  const items = (data?.items ?? []).filter((o) => {
    if (!q.trim()) return true;
    const n = q.toLowerCase();
    return o.code.toLowerCase().includes(n) || o.buyerName.toLowerCase().includes(n) || o.lines.some((l) => l.title.toLowerCase().includes(n));
  });

  async function fulfil(code: string, action: 'pack' | 'ship' | 'cancel', note?: string) {
    setBusy(code);
    setErr(null);
    setMsg(null);
    try {
      await api.post(`/seller/orders/${code}/fulfil`, { action, note });
      setMsg(
        action === 'pack' ? `${code} packed. Ship within 48 hours to protect your on-time rate.`
        : action === 'ship' ? `${code} handed to the courier. The buyer has been notified.`
        : `${code} cancelled. Any captured funds go back to the buyer.`,
      );
      setCancelling(null);
      setCancelNote('');
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update that order.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Loading orders…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Orders</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {data?.counts.confirmed ?? 0} to pack · {data?.counts.packed ?? 0} to ship
          </p>
        </div>
        <div className="relative w-full sm:w-64">
          <SearchIcon className="pointer-events-none absolute top-1/2 left-3 size-3.5 -translate-y-1/2 text-ink-3" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Order, buyer or product" className="h-9 pl-9 text-xs" />
        </div>
      </div>

      <Tabs
        tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: f.id ? data?.counts[f.id] : undefined }))}
        value={tab}
        onChange={setTab}
      />

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {items.length === 0 ? (
        <Empty icon={<Package className="size-5" />} title="No orders in this view" message="Try another filter, or wait for the next order to arrive." />
      ) : (
        <div className="space-y-3">
          {items.map((o) => (
            <Card key={o.id} className={clsx(o.needsAction && 'border-gold/30')}>
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-line pb-2.5">
                <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                  <span className="font-mono text-xs font-bold">{o.code}</span>
                  <StatusBadge status={o.status} />
                  {o.needsAction && <Badge tone="gold">Needs you</Badge>}
                  {o.channel === 'b2b' && <Badge tone="violet">B2B</Badge>}
                  {o.riskFlags.length > 0 && <Badge tone="warn">Risk {o.riskScore}</Badge>}
                </div>
                <div className="text-right">
                  <p className="font-display text-sm font-bold">{birr(o.total)}</p>
                  <p className="text-[10px] text-ink-3">{dateOnly(o.placedAt)}</p>
                </div>
              </div>

              {/*
                * `grid-cols-1` is what keeps this inside the viewport, and it is not
                * a no-op next to the `sm:` variant. Without it the mobile track is
                * the implicit `auto` one, whose minimum is the item's min-content
                * width — and a product title plus a right-aligned `ETB` amount is
                * wider than a phone, so the track grew past the card and pushed the
                * page into horizontal scroll. `minmax(0, 1fr)` lets the track stay
                * at the card's width and the `truncate` inside it actually engage.
                */}
              <div className="grid grid-cols-1 gap-3 py-3 sm:grid-cols-[1fr_220px]">
                <div className="min-w-0">
                  <p className="text-xs font-semibold">{o.buyerName}</p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {o.address.city} · {o.address.subcity}, {o.address.woreda} · {titleCase(o.paymentMethod)}
                  </p>
                  <div className="mt-2 space-y-1">
                    {o.lines.map((l) => (
                      <p key={l.id} className="flex items-center gap-2 text-[11px]">
                        <span className="flex size-8 shrink-0 items-center justify-center rounded border border-line bg-surface-2 text-[9px] font-bold">
                          {l.qty}×
                        </span>
                        <span className="min-w-0 flex-1 truncate">{l.title}</span>
                        <span className="shrink-0 text-ink-3">{birr(l.lineTotal)}</span>
                      </p>
                    ))}
                  </div>
                </div>

                <div className="min-w-0 text-[11px] text-ink-2">
                  <p className="font-semibold text-ink">Ship to</p>
                  <p>{o.address.recipient}</p>
                  <p className="text-ink-3">{o.address.house}, {o.address.kebele}</p>
                  {o.address.note && <p className="mt-1 text-warn">Note: {o.address.note}</p>}
                  {o.shipment && (
                    <p className="mt-1.5 flex items-center gap-1 text-ink-3">
                      <Truck className="size-3" /> {statusLabel(o.shipment.status)} · {o.shipment.attempt} attempt{o.shipment.attempt === 1 ? '' : 's'}
                    </p>
                  )}
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-2 border-t border-line pt-2.5">
                {o.status === 'confirmed' && (
                  <Button size="sm" variant="primary" loading={busy === o.code} onClick={() => void fulfil(o.code, 'pack')} icon={<Package className="size-3.5" />}>
                    Mark packed
                  </Button>
                )}
                {o.status === 'packed' && (
                  <Button size="sm" variant="primary" loading={busy === o.code} onClick={() => void fulfil(o.code, 'ship')} icon={<Truck className="size-3.5" />}>
                    Hand to courier
                  </Button>
                )}
                {['delivered', 'completed'].includes(o.status) && (
                  <Badge tone="ok">Delivered {dateOnly(o.shipment?.deliveredAt)}</Badge>
                )}
                {['confirmed', 'packed', 'shipped'].includes(o.status) && cancelling !== o.code && (
                  <Button size="sm" variant="ghost" className="ml-auto text-bad" onClick={() => setCancelling(o.code)}>
                    Cancel order
                  </Button>
                )}
                {cancelling === o.code && (
                  <div className="ml-auto flex w-full items-end gap-2 sm:w-auto">
                    <Textarea
                      rows={1}
                      value={cancelNote}
                      onChange={(e) => setCancelNote(e.target.value)}
                      placeholder="Why are you cancelling? The buyer sees this."
                      className="h-9 flex-1 text-xs sm:w-72"
                    />
                    <Button size="sm" variant="danger" loading={busy === o.code} onClick={() => void fulfil(o.code, 'cancel', cancelNote)}>
                      Confirm
                    </Button>
                    <Button size="sm" variant="ghost" onClick={() => setCancelling(null)} icon={<X className="size-3.5" />} />
                  </div>
                )}
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
