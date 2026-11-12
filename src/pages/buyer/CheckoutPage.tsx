import { useMemo, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  AlertTriangle, Banknote, Building2, CheckCircle2, CreditCard, Landmark,
  MapPin, Phone, ShieldCheck, Smartphone, Truck,
} from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, etbAmount, titleCase } from '../../lib/format.ts';
import {
  Badge, Button, Card, ErrorNote, KeyValue, Notice, Spinner, Textarea,
} from '../../components/ui.tsx';
import type { Address, Order } from '../../../shared/types.ts';

interface Summary {
  lines: { offerId: string; title: string; image: string; qty: number; unitPrice: number; lineTotal: number; sellerName: string }[];
  totals: { subtotal: number; delivery: number; tax: number; discount: number; total: number; itemCount: number; savings: number };
  deliveryEstimate: { min: number; max: number; fee: number };
  codFee: number;
  promo: { discount: number; label: string; code: string } | null;
  breakdown: { label: string; value: number }[];
  total: number;
  totalWithVatNote: string;
  trustNote: string;
}

type Method = 'cod' | 'telebirr' | 'cbe_birr' | 'awash' | 'bank_transfer';

const METHODS: { id: Method; label: string; am: string; icon: typeof Banknote; note: string; recommended?: boolean }[] = [
  { id: 'cod', label: 'Cash on delivery', am: 'በገንዘብ ሲደርስ', icon: Banknote, note: 'Inspect the parcel, then pay the agent. Largest method in Ethiopia.', recommended: true },
  { id: 'telebirr', label: 'Telebirr', am: 'ተሌብር', icon: Smartphone, note: 'Two-step confirmation to your registered phone.' },
  { id: 'cbe_birr', label: 'CBE Birr', am: 'ሲቢኢ ብር', icon: Smartphone, note: 'Two-step confirmation to your registered phone.' },
  { id: 'awash', label: 'Awash Bank', am: 'አዋሽ ባንክ', icon: Landmark, note: 'Bank transfer, confirmed by the provider.' },
  { id: 'bank_transfer', label: 'Bank transfer', am: 'የባንክ ማስቀመጥ', icon: Building2, note: 'For larger business purchases. Funds clear before dispatch.' },
];

export function CheckoutPage() {
  const summary = useQuery<Summary>('/checkout/summary');
  // `/addresses` answers `{ items: [...] }` like every other list endpoint, so it
  // is unwrapped once here. Typing this as `Address[]` and calling `.find` on the
  // wrapper throws on load, and an uncaught render error unmounts the whole
  // route — the page comes back blank, not merely empty.
  const addresses = useQuery<{ items: Address[] }>('/addresses');
  const addressList = addresses.data?.items ?? [];

  const [addressId, setAddressId] = useState<string | null>(null);
  const [method, setMethod] = useState<Method>('cod');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [placed, setPlaced] = useState<{ order: Order; message?: string } | null>(null);
  const [otp, setOtp] = useState('');
  const [otpStage, setOtpStage] = useState<string | null>(null);
  const [masked, setMasked] = useState('');

  // One idempotency key per checkout attempt, so a double tap or a dropped
  // connection can never create two orders.
  const idemKey = useMemo(() => `ck_${Math.random().toString(36).slice(2)}_${Date.now()}`, []);

  const chosen = addressList.find((a) => a.id === addressId) ?? addressList.find((a) => a.isDefault) ?? null;
  const effectiveAddressId = chosen?.id ?? null;

  async function placeOrder() {
    if (!effectiveAddressId) {
      setErr('Choose a delivery address first.');
      return;
    }
    if (summary.data && summary.data.lines.length === 0) {
      setErr('Your cart is empty.');
      return;
    }
    setBusy(true);
    setErr(null);
    try {
      const res = await api.post<{ order: Order; replayed: boolean; message?: string }>('/checkout', {
        addressId: effectiveAddressId,
        paymentMethod: method,
        note: note.trim() || undefined,
        idempotencyKey: idemKey,
      });
      setPlaced({ order: res.order, message: res.message });

      if (method !== 'cod') {
        const step = await api.post<{ requiresOtp?: boolean; maskedPhone?: string; message?: string }>(
          '/checkout/payment',
          { orderCode: res.order.code, method },
        );
        if (step.requiresOtp) {
          setOtpStage(res.order.code);
          setMasked(step.maskedPhone ?? '');
        }
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not place the order.');
    } finally {
      setBusy(false);
    }
  }

  async function confirmOtp(e: React.FormEvent) {
    e.preventDefault();
    if (!otpStage) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post('/checkout/payment', { orderCode: otpStage, method, otp });
      setOtpStage(null);
      setOtp('');
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That code was not accepted.');
    } finally {
      setBusy(false);
    }
  }

  if (placed && !otpStage) {
    return <OrderPlaced order={placed.order} message={placed.message} method={method} />;
  }

  if (summary.loading || addresses.loading) return <Spinner label="Preparing checkout…" />;
  if (summary.error) return <ErrorNote message={summary.error} onRetry={summary.reload} />;

  const s = summary.data;
  if (!s || s.lines.length === 0) {
    return (
      <Card>
        <p className="text-sm font-semibold">Your cart is empty.</p>
        <p className="mt-1 text-xs text-ink-3">Add something before checking out.</p>
        <Link to="/search" className="mt-3 inline-block">
          <Button variant="primary">Browse products</Button>
        </Link>
      </Card>
    );
  }

  return (
    <div className="space-y-5">
      <h1 className="font-display text-xl font-bold">Checkout</h1>

      {err && <ErrorNote message={err} />}

      {otpStage && (
        <Card className="border-brand/30 bg-brand-soft/20">
          <p className="flex items-center gap-2 text-sm font-bold">
            <Smartphone className="size-4 text-brand" /> Confirm your payment
          </p>
          <p className="mt-1 text-xs text-ink-2">
            We sent a 6-digit code to {masked}. Enter it to release your order for packing.
          </p>
          <form onSubmit={confirmOtp} className="mt-3 flex gap-2">
            <input
              value={otp}
              onChange={(e) => setOtp(e.target.value.replace(/\D/g, '').slice(0, 6))}
              inputMode="numeric"
              placeholder="000000"
              className="h-11 w-40 rounded-md border border-line bg-surface px-3 text-center font-mono text-lg tracking-[0.4em] focus:border-brand focus:outline-none"
            />
            <Button type="submit" variant="primary" loading={busy}>Confirm</Button>
          </form>
          <p className="mt-2 text-[10px] text-ink-3">
            Sandbox build: any six digits are accepted, so the flow can be walked end to end.
          </p>
        </Card>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_380px]">
        <div className="space-y-4">
          {/* address */}
          <Card>
            <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
              <MapPin className="size-4 text-brand" /> Delivery address
            </p>
            <div className="space-y-2">
              {addressList.map((a) => (
                <button
                  key={a.id}
                  onClick={() => setAddressId(a.id)}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                    chosen?.id === a.id ? 'border-brand bg-brand-soft/25' : 'border-line hover:bg-surface-2',
                  )}
                >
                  <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-brand">
                    {chosen?.id === a.id && <span className="size-1.5 rounded-full bg-brand" />}
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{a.label}</span>
                      {a.isDefault && <Badge tone="muted">Default</Badge>}
                    </span>
                    <span className="mt-0.5 block text-xs text-ink-2">{a.recipient} · {a.phone}</span>
                    <span className="mt-0.5 block text-[11px] leading-relaxed text-ink-3">
                      {a.house}, {a.kebele}, {a.woreda}, {a.subcity}, {a.city}
                      {a.landmark && ` · near ${a.landmark}`}
                    </span>
                    {a.note && <span className="mt-0.5 block text-[11px] text-warn">Note: {a.note}</span>}
                  </span>
                </button>
              ))}
            </div>
          </Card>

          {/* payment */}
          <Card>
            <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
              <CreditCard className="size-4 text-brand" /> Payment method
            </p>
            <div className="space-y-2">
              {METHODS.map((m) => (
                <button
                  key={m.id}
                  onClick={() => setMethod(m.id)}
                  className={clsx(
                    'flex w-full items-start gap-3 rounded-md border p-3 text-left transition-colors',
                    method === m.id ? 'border-brand bg-brand-soft/25' : 'border-line hover:bg-surface-2',
                  )}
                >
                  <m.icon className={clsx('mt-0.5 size-4 shrink-0', method === m.id ? 'text-brand' : 'text-ink-3')} />
                  <span className="min-w-0 flex-1">
                    <span className="flex flex-wrap items-center gap-1.5">
                      <span className="text-sm font-semibold">{m.label}</span>
                      {m.recommended && <Badge tone="gold">Most used</Badge>}
                    </span>
                    <span className="block text-[11px] text-ink-3" lang="am">{m.am}</span>
                    <span className="mt-0.5 block text-[11px] text-ink-2">{m.note}</span>
                  </span>
                </button>
              ))}
            </div>

            {method === 'cod' && (
              <Notice tone="gold" title={`You will pay ${birr(s.total)} at the door`}>
                The agent collects cash when you accept the parcel. That cash is reconciled against a bank remittance
                before the seller's balance is released — so neither side is taking the other's word for it.
              </Notice>
            )}
          </Card>

          {/* note */}
          <Card>
            <label className="mb-1.5 block text-xs font-semibold text-ink-2">Note for the seller or agent</label>
            <Textarea
              rows={3}
              value={note}
              onChange={(e) => setNote(e.target.value)}
              placeholder="Call before arriving. Deliver to the reception desk."
            />
          </Card>
        </div>

        {/* summary */}
        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <h2 className="mb-3 font-display text-base font-bold">Your order</h2>
            <div className="space-y-2.5">
              {s.lines.map((l) => (
                <div key={l.offerId} className="flex gap-2.5">
                  <img src={l.image} alt="" className="size-14 shrink-0 rounded-md border border-line object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="clamp-2 text-xs font-semibold">{l.title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-3">{l.sellerName} · qty {l.qty}</p>
                  </div>
                  <span className="shrink-0 text-xs font-semibold tabular-nums">{birr(l.lineTotal, { decimals: false })}</span>
                </div>
              ))}
            </div>

            <div className="mt-3 border-t border-line pt-2">
              {s.breakdown.map((b) => (
                <KeyValue key={b.label} k={b.label} v={b.value < 0 ? <span className="text-ok">−{birr(Math.abs(b.value))}</span> : birr(b.value)} />
              ))}
            </div>

            <div className="mt-3 flex items-baseline justify-between border-t border-line pt-3">
              <span className="text-sm font-bold">Total</span>
              <span className="font-display text-xl font-bold">{birr(s.total)}</span>
            </div>
            <p className="mt-1 text-right text-[10px] text-ink-3">{etbAmount(s.total)}</p>

            <Button
              block
              size="lg"
              variant="primary"
              className="mt-3"
              loading={busy}
              disabled={!effectiveAddressId || s.lines.length === 0}
              onClick={placeOrder}
            >
              {method === 'cod' ? 'Place order' : `Pay ${birr(s.total)}`}
            </Button>

            <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
              {s.totalWithVatNote} {s.trustNote}
            </p>
          </Card>

          <Card>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
              <Truck className="size-3.5 text-brand" /> Estimated delivery
            </p>
            <p className="text-sm font-semibold">
              {s.deliveryEstimate.min}–{s.deliveryEstimate.max} days after dispatch
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              {chosen ? `To ${chosen.city}. ` : 'Choose an address for a city-specific estimate. '}
              Remote woredas add a day.
            </p>
          </Card>

          <Card>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
              <ShieldCheck className="size-3.5 text-brand" /> Buyer protection
            </p>
            <ul className="space-y-1.5 text-[11px] leading-relaxed text-ink-2">
              <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Money is held in escrow, not sent to the seller on checkout.</li>
              <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Inspect the parcel before paying cash.</li>
              <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> 7 days to open a dispute, with photos.</li>
              <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Every decision is written down with a reason.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}

function OrderPlaced({ order, message, method }: { order: Order; message?: string; method: Method }) {
  const label = titleCase(method);
  return (
    <div className="mx-auto max-w-2xl space-y-4">
      <Card className="animate-rise border-ok/30 bg-ok-soft/20 text-center">
        <CheckCircle2 className="mx-auto size-10 text-ok" />
        <h1 className="mt-2 font-display text-xl font-bold">Order placed</h1>
        <p className="mt-1 text-sm text-ink-2">
          <span className="font-semibold">{order.code}</span> · {label}
        </p>
        {message ? (
          <Notice tone="info" className="mt-3 text-left">{message}</Notice>
        ) : (
          <p className="mt-2 text-xs text-ink-3">
            {method === 'cod'
              ? 'Nothing has been charged yet. The agent collects cash when the parcel is accepted.'
              : 'Funds are held in escrow until delivery is confirmed.'}
          </p>
        )}
        <div className="mt-4 flex flex-wrap justify-center gap-2">
          <Link to={`/orders/${order.code}`}>
            <Button variant="primary" icon={<MapPin className="size-4" />}>Track this order</Button>
          </Link>
          <Link to={`/track/${order.code}`}>
            <Button variant="secondary" icon={<Truck className="size-4" />}>Delivery status</Button>
          </Link>
          <Link to="/orders">
            <Button variant="ghost">All orders</Button>
          </Link>
        </div>
      </Card>

      <Card>
        <p className="mb-2 text-sm font-bold">What happens next</p>
        <ol className="space-y-2 text-xs leading-relaxed text-ink-2">
          {[
            { icon: CheckCircle2, t: 'Order confirmed', d: 'The seller is notified and given a packing deadline.' },
            { icon: Phone, t: 'Seller packs and hands off', d: 'You get an SMS when a delivery agent is assigned.' },
            { icon: Truck, t: 'Out for delivery', d: 'The agent calls you. Inspect the parcel before paying.' },
            { icon: ShieldCheck, t: 'Proof of delivery', d: 'Photo, signature or OTP is captured. Only then is the seller paid.' },
          ].map((step, i) => (
            <li key={step.t} className="flex gap-2.5">
              <span className="flex size-6 shrink-0 items-center justify-center rounded-full bg-brand-soft text-[11px] font-bold text-brand-ink">
                {i + 1}
              </span>
              <span>
                <span className="font-semibold">{step.t}</span>
                <span className="block text-ink-3">{step.d}</span>
              </span>
            </li>
          ))}
        </ol>
        {order.riskFlags.length > 0 && (
          <Notice tone="warn" title="This order was reviewed before dispatch" className="mt-3">
            <span className="flex flex-wrap gap-1">
              {order.riskFlags.map((f) => <Badge key={f} tone="warn">{titleCase(f)}</Badge>)}
            </span>
            <p className="mt-1.5">
              Risk score {order.riskScore}/100. High-value cash orders are sometimes held for extra confirmation —
              that is a rule, not a judgement about you.
            </p>
          </Notice>
        )}
        <Notice tone="warn" title="Watch out for advance-fee scams" className="mt-3">
          <span className="flex items-start gap-1.5">
            <AlertTriangle className="mt-0.5 size-3 shrink-0" />
            No legitimate seller on HaniMarket will ask you to send money before a parcel arrives. Report anyone who does.
          </span>
        </Notice>
      </Card>

      <Card>
        <KeyValue k="Items" v={order.lines.reduce((a, l) => a + l.qty, 0)} />
        <KeyValue k="Subtotal" v={birr(order.subtotal)} />
        <KeyValue k="VAT" v={birr(order.tax)} />
        <KeyValue k="Total" v={<span className="font-bold">{birr(order.total)}</span>} />
        {order.fiscalReceiptNo && <KeyValue k="Fiscal receipt" v={order.fiscalReceiptNo} mono />}
      </Card>
    </div>
  );
}
