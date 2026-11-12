import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  AlertTriangle, Banknote, FileText, MapPin, MessageSquare, Package,
  ShieldAlert, ShieldCheck, Star, Truck,
} from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, dateOnly, dateTime, titleCase } from '../../lib/format.ts';
import {
  Badge, Button, Card, ErrorNote, Field, KeyValue, Notice, Spinner, StatusBadge, Textarea,
} from '../../components/ui.tsx';
import type { Dispute, Order, StatusEvent } from '../../../shared/types.ts';

interface Detail {
  order: Order;
  legs: { id: string; kind: string; partner: string; status: string; from: string; to: string; at: string }[];
  payment: { method: string; state: string; amount: number; provider: string; idempotencyKey: string } | null;
  dispute: Dispute | null;
  invoice: { id: string; code: string; amount: number; dueAt: string; status: string } | null;
  canRate: boolean;
}

const STEPS = ['placed', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered'];

export function OrderPage() {
  const { code = '' } = useParams();
  const { data, loading, error, reload } = useQuery<Detail>(`/orders/${code}`);
  const [rating, setRating] = useState(5);
  const [reviewTitle, setReviewTitle] = useState('');
  const [reviewBody, setReviewBody] = useState('');
  const [posting, setPosting] = useState(false);
  const [reviewMsg, setReviewMsg] = useState<string | null>(null);

  if (loading) return <Spinner label="Loading order…" />;
  if (error || !data) return <ErrorNote message={error ?? 'Order not found.'} onRetry={reload} />;

  const o = data.order;
  const stepIdx = STEPS.indexOf(o.status);
  const cancelled = o.status === 'cancelled';

  async function submitReview(productId: string, e: React.FormEvent) {
    e.preventDefault();
    setPosting(true);
    setReviewMsg(null);
    try {
      const res = await api.post<{ note: string }>(`/products/${productId}/reviews`, {
        rating,
        title: reviewTitle.trim() || 'Verified purchase',
        body: reviewBody.trim(),
      });
      setReviewMsg(res.note);
    } catch (e2) {
      setReviewMsg(e2 instanceof ApiError ? e2.message : 'Could not submit the review.');
    } finally {
      setPosting(false);
    }
  }

  return (
    <div className="space-y-5">
      <nav className="flex items-center gap-1.5 text-[11px] text-ink-3">
        <Link to="/orders" className="hover:text-brand">Orders</Link>
        <span>/</span>
        <span className="font-mono font-semibold">{o.code}</span>
      </nav>

      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Order {o.code}</h1>
          <p className="mt-0.5 text-xs text-ink-3">Placed {dateTime(o.placedAt)} · {titleCase(o.paymentMethod)}</p>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={o.status} />
          {o.channel === 'b2b' && <Badge tone="violet">B2B invoice</Badge>}
          <Link to={`/track/${o.code}`}>
            <Button size="sm" variant="secondary" icon={<Truck className="size-3.5" />}>Track</Button>
          </Link>
        </div>
      </div>

      {o.riskFlags.length > 0 && (
        <Notice tone="warn" title="Risk checks ran on this order">
          <div className="flex flex-wrap gap-1">
            {o.riskFlags.map((f) => <Badge key={f} tone="warn">{titleCase(f)}</Badge>)}
          </div>
          <p className="mt-1.5">Score {o.riskScore}/100. Rules are published in the admin risk console, including how often each one fires and how often it is wrong.</p>
        </Notice>
      )}

      {/* progress */}
      {!cancelled && (
        <Card>
          <ol className="flex items-center gap-1">
            {STEPS.map((s, i) => (
              <li key={s} className="flex min-w-0 flex-1 items-center gap-1">
                <div className="flex min-w-0 flex-1 flex-col items-center gap-1.5">
                  <span
                    className={clsx(
                      'flex size-7 items-center justify-center rounded-full text-[11px] font-bold transition-colors',
                      i <= stepIdx ? 'bg-brand text-white' : 'bg-surface-3 text-ink-3',
                    )}
                  >
                    {i < stepIdx ? '✓' : i + 1}
                  </span>
                  <span className={clsx('text-center text-[10px] leading-tight', i <= stepIdx ? 'font-semibold text-ink' : 'text-ink-3')}>
                    {titleCase(s.replace('_', ' '))}
                  </span>
                </div>
                {i < STEPS.length - 1 && (
                  <span className={clsx('mb-5 h-0.5 w-full rounded-full', i < stepIdx ? 'bg-brand' : 'bg-surface-3')} />
                )}
              </li>
            ))}
          </ol>
          <p className="mt-3 text-center text-[11px] text-ink-3">
            Expected between {dateOnly(o.etaFrom)} and {dateOnly(o.etaTo)}
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* items */}
          <Card>
            <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
              <Package className="size-4 text-brand" /> Items
            </p>
            <div className="space-y-3">
              {o.lines.map((l) => (
                <div key={l.id} className="flex gap-3 border-b border-line pb-3 last:border-0 last:pb-0">
                  <Link to={`/product/${l.productId}`} className="shrink-0">
                    <img src={l.image} alt={l.title} className="size-16 rounded-md border border-line object-cover" />
                  </Link>
                  <div className="min-w-0 flex-1">
                    <Link to={`/product/${l.productId}`} className="text-sm font-semibold hover:text-brand">{l.title}</Link>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      {l.sellerName} · {titleCase(l.condition)} · qty {l.qty}
                    </p>
                    <p className="mt-1 text-xs text-ink-2">{birr(l.unitPrice)} each</p>
                  </div>
                  <span className="shrink-0 text-sm font-bold">{birr(l.lineTotal)}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t border-line pt-2">
              <KeyValue k="Subtotal" v={birr(o.subtotal)} />
              <KeyValue k="Delivery" v={o.deliveryFee ? birr(o.deliveryFee) : <Badge tone="ok">Free</Badge>} />
              <KeyValue k="VAT (15%)" v={birr(o.tax)} />
              {o.discount > 0 && <KeyValue k="Discount" v={<span className="text-ok">−{birr(o.discount)}</span>} />}
              <div className="mt-1 flex items-baseline justify-between border-t border-line pt-2">
                <span className="text-sm font-bold">Total</span>
                <span className="font-display text-lg font-bold">{birr(o.total)}</span>
              </div>
            </div>
          </Card>

          {/* history */}
          <Card>
            <p className="mb-3 text-sm font-bold">Order history</p>
            <ol className="space-y-3">
              {o.history.map((h: StatusEvent, i: number) => (
                <li key={`${h.status}-${i}`} className="flex gap-3">
                  <span className="mt-1 size-2 shrink-0 rounded-full bg-brand" />
                  <div className="min-w-0">
                    <p className="text-xs font-semibold">{titleCase(h.status)}</p>
                    {h.note && <p className="text-[11px] leading-relaxed text-ink-2">{h.note}</p>}
                    <p className="text-[10px] text-ink-3">{dateTime(h.at)} · {h.actor}</p>
                  </div>
                </li>
              ))}
            </ol>
          </Card>

          {/* review */}
          {data.canRate && (
            <Card>
              <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
                <Star className="size-4 text-gold" /> Review your purchase
              </p>
              <form onSubmit={(e) => void submitReview(o.lines[0]!.productId, e)} className="space-y-3">
                <div className="flex items-center gap-1">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button
                      key={n}
                      type="button"
                      onClick={() => setRating(n)}
                      className="p-0.5"
                      aria-label={`${n} stars`}
                    >
                      <Star className={clsx('size-6', n <= rating ? 'fill-gold text-gold' : 'text-ink-3')} />
                    </button>
                  ))}
                  <span className="ml-2 text-xs text-ink-3">{rating} of 5</span>
                </div>
                <Field label="Headline">
                  <input
                    value={reviewTitle}
                    onChange={(e) => setReviewTitle(e.target.value)}
                    placeholder="Exactly what arrived"
                    className="h-10 w-full rounded-md border border-line bg-surface px-3 text-sm focus:border-brand focus:outline-none"
                  />
                </Field>
                <Field label="Your experience">
                  <Textarea
                    rows={3}
                    value={reviewBody}
                    onChange={(e) => setReviewBody(e.target.value)}
                    placeholder="Was the packaging intact? Did the agent arrive on time?"
                  />
                </Field>
                <Button type="submit" variant="primary" loading={posting}>Submit review</Button>
                {reviewMsg && <Notice tone="info">{reviewMsg}</Notice>}
              </form>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {/* address */}
          <Card>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              <MapPin className="size-4 text-brand" /> Delivering to
            </p>
            <p className="text-sm font-semibold">{o.address.recipient}</p>
            <p className="text-xs text-ink-2">{o.address.phone}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">
              {o.address.house}, {o.address.kebele}, {o.address.woreda}, {o.address.subcity}, {o.address.city}
            </p>
            {o.address.note && <p className="mt-1 text-[11px] text-warn">{o.address.note}</p>}
            {o.addressSnapshotNote && (
              <p className="mt-1.5 border-t border-line pt-1.5 text-[10px] text-ink-3">{o.addressSnapshotNote}</p>
            )}
          </Card>

          {/* payment */}
          <Card>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              <Banknote className="size-4 text-brand" /> Payment
            </p>
            {data.payment ? (
              <>
                <KeyValue k="Method" v={titleCase(data.payment.method)} />
                <KeyValue k="State" v={<StatusBadge status={data.payment.state} />} />
                <KeyValue k="Amount" v={birr(data.payment.amount)} />
                {o.refunded > 0 && <KeyValue k="Refunded" v={<span className="text-warn">{birr(o.refunded)}</span>} />}
              </>
            ) : (
              <p className="text-xs text-ink-3">No payment record — this order is on cash on delivery.</p>
            )}
            <p className="mt-2 flex items-start gap-1.5 text-[10px] leading-relaxed text-ink-3">
              <ShieldCheck className="mt-0.5 size-3 shrink-0 text-brand" />
              {titleCase(o.paymentMethod) === 'Cod'
                ? 'Nothing was charged. The agent collects cash on delivery and that cash is reconciled against a bank remittance.'
                : 'Captured funds sit in escrow. Capture is not the same as payable — the seller is paid after proof of delivery.'}
            </p>
          </Card>

          {/* receipts */}
          {(o.fiscalReceiptNo || data.invoice || o.invoiceNo) && (
            <Card>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <FileText className="size-4 text-brand" /> Receipts
              </p>
              {o.fiscalReceiptNo && <KeyValue k="Fiscal receipt" v={o.fiscalReceiptNo} mono />}
              {o.invoiceNo && <KeyValue k="Invoice" v={o.invoiceNo} mono />}
              {data.invoice && (
                <>
                  <KeyValue k="Invoice code" v={data.invoice.code} mono />
                  <KeyValue k="Amount" v={birr(data.invoice.amount)} />
                  <KeyValue k="Due" v={dateOnly(data.invoice.dueAt)} />
                </>
              )}
              <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
                A fiscalised receipt is issued for every order so it can be claimed as a business expense.
              </p>
            </Card>
          )}

          {/* shipment */}
          {o.shipment && (
            <Card>
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <Truck className="size-4 text-brand" /> Shipment
              </p>
              <KeyValue k="Partner" v={titleCase(o.shipment.partner)} />
              <KeyValue k="Status" v={<StatusBadge status={o.shipment.status} />} />
              <KeyValue k="Zone" v={o.shipment.zone} />
              <KeyValue k="Attempts" v={o.shipment.attempt} />
              {o.shipment.pod && (
                <>
                  <KeyValue k="Proof" v={titleCase(o.shipment.pod.kind)} />
                  {o.shipment.pod.recipientName && <KeyValue k="Signed by" v={o.shipment.pod.recipientName} />}
                  {o.shipment.pod.syncedFromOffline && (
                    <Notice tone="info" className="mt-2">
                      This proof of delivery was captured offline and synced later. The sync time is recorded
                      separately from the capture time.
                    </Notice>
                  )}
                </>
              )}
              {o.shipment.failureReason && (
                <Notice tone="bad" className="mt-2">Delivery failed: {o.shipment.failureReason}</Notice>
              )}
            </Card>
          )}

          {/* legs */}
          {data.legs.length > 0 && (
            <Card>
              <p className="mb-2.5 text-sm font-bold">Journey</p>
              <ol className="space-y-2.5">
                {data.legs.map((l) => (
                  <li key={l.id} className="flex gap-2.5">
                    <span className={clsx('mt-1 size-2 shrink-0 rounded-full', l.status === 'completed' ? 'bg-ok' : l.status === 'pending' ? 'bg-surface-3' : 'bg-warn')} />
                    <div className="min-w-0">
                      <p className="text-xs font-semibold">{titleCase(l.kind)} · {l.partner}</p>
                      <p className="text-[11px] text-ink-3">{l.from} → {l.to}</p>
                      <p className="text-[10px] text-ink-3">{dateTime(l.at)}</p>
                    </div>
                  </li>
                ))}
              </ol>
            </Card>
          )}

          {/* dispute */}
          {data.dispute ? (
            <Card className="border-warn/30">
              <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
                <ShieldAlert className="size-4 text-warn" /> Dispute {data.dispute.code}
              </p>
              <KeyValue k="Reason" v={titleCase(data.dispute.reason)} />
              <KeyValue k="Status" v={<StatusBadge status={data.dispute.status} />} />
              <KeyValue k="Amount held" v={birr(data.dispute.amount)} />
              <KeyValue k="Decide by" v={dateTime(data.dispute.dueAt)} />
              {data.dispute.resolution && (
                <Notice tone={data.dispute.resolution.outcome === 'release_to_seller' ? 'info' : 'warn'} className="mt-2">
                  {titleCase(data.dispute.resolution.outcome)} · {birr(data.dispute.resolution.amount)}. {data.dispute.resolution.note}
                </Notice>
              )}
              <Link to="/disputes" className="mt-3 block">
                <Button block size="sm" variant="secondary" icon={<MessageSquare className="size-3.5" />}>Open dispute centre</Button>
              </Link>
            </Card>
          ) : (
            <Card>
              <p className="mb-1.5 flex items-center gap-1.5 text-sm font-bold">
                <ShieldAlert className="size-4 text-bad" /> Something wrong?
              </p>
              <p className="text-[11px] leading-relaxed text-ink-2">
                You have 7 days after delivery to open a dispute. Attach photos of the parcel and the item — evidence
                is what moves a case, not the strength of the complaint.
              </p>
              <Link to="/disputes" className="mt-2 block">
                <Button block size="sm" variant="secondary">Open a dispute</Button>
              </Link>
              <p className="mt-2 flex items-start gap-1.5 text-[10px] text-ink-3">
                <AlertTriangle className="mt-0.5 size-3 shrink-0 text-warn" />
                Never send money to "unlock" a delivery or pay a customs fee directly to a courier. Report it.
              </p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
