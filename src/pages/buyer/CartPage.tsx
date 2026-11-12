import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Minus, Package, Plus, ShieldCheck, ShoppingCart, Tag, Trash2, Truck, X } from 'lucide-react';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { useSession } from '../../lib/session.tsx';
import { birr, titleCase } from '../../lib/format.ts';
import {
  Badge, Button, Card, Empty, ErrorNote, KeyValue, Notice, Spinner, Textarea,
} from '../../components/ui.tsx';

interface CartLine {
  id: string;
  offerId: string;
  productId: string;
  sellerId: string;
  sellerName: string;
  title: string;
  titleAm: string;
  image: string;
  unitPrice: number;
  qty: number;
  stock: number;
  condition: string;
  fulfillment: string;
  etaDays: [number, number];
  lineTotal: number;
}
interface CartView {
  lines: CartLine[];
  totals: { subtotal: number; delivery: number; tax: number; discount: number; total: number; itemCount: number; savings: number };
  deliveryEstimate: { min: number; max: number; fee: number };
  codFee: number;
  promo: { discount: number; label: string; code: string } | null;
}

export function CartPage() {
  const { data, loading, error, reload, setData } = useQuery<CartView>('/cart');
  const { refresh } = useSession();
  const navigate = useNavigate();
  const [code, setCode] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function change(offerId: string, qty: number) {
    setErr(null);
    try {
      if (qty <= 0) {
        await api.del(`/cart/${offerId}`);
      } else {
        await api.patch(`/cart/${offerId}`, { qty });
      }
      const fresh = await fetch('/api/cart').then((r) => r.json()) as CartView;
      setData(fresh);
      await refresh();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update the cart.');
    }
  }

  async function applyPromo(e: React.FormEvent) {
    e.preventDefault();
    if (!code.trim()) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post<{ valid: boolean; message: string }>('/promotions/validate', { code: code.trim() });
      if (res.valid) {
        setMsg(`${res.message} Applied.`);
        reload();
      } else {
        setErr(res.message);
      }
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not check that code.');
    } finally {
      setBusy(false);
    }
  }

  async function clearCart() {
    setBusy(true);
    try {
      await api.del('/cart');
      reload();
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading your cart…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  if (data.lines.length === 0) {
    return (
      <Empty
        icon={<ShoppingCart className="size-5" />}
        title="Your cart is empty"
        message="Nothing here yet. Cash on delivery is available nationwide, and most sellers dispatch within a day."
        action={<Link to="/search"><Button variant="primary">Start shopping</Button></Link>}
      />
    );
  }

  // Group by seller: escrow and delivery are per seller, not per basket.
  const bySeller = data.lines.reduce<Record<string, CartLine[]>>((acc, l) => {
    (acc[l.sellerId] ??= []).push(l);
    return acc;
  }, {});

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h1 className="font-display text-xl font-bold">Your cart ({data.totals.itemCount})</h1>
        <Button size="sm" variant="ghost" onClick={clearCart} loading={busy} icon={<Trash2 className="size-3.5" />}>
          Empty cart
        </Button>
      </div>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {data.promo && (
        <Notice tone="gold" title={`Promotion applied · ${data.promo.code}`}>
          {data.promo.label} — you saved {birr(data.promo.discount)}.
        </Notice>
      )}

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {Object.entries(bySeller).map(([sellerId, lines]) => (
            <Card key={sellerId} className="p-0">
              <div className="flex items-center justify-between gap-2 border-b border-line px-4 py-2.5">
                <p className="flex items-center gap-2 text-xs font-bold">
                  <ShieldCheck className="size-3.5 text-brand" />
                  Sold and fulfilled by {lines[0]!.sellerName}
                </p>
                <Badge tone="ok">Escrow protected</Badge>
              </div>
              <div className="divide-y divide-line">
                {lines.map((l) => (
                  <div key={l.id} className="flex gap-3 p-4">
                    <Link to={`/product/${l.productId}`} className="shrink-0">
                      <img src={l.image} alt={l.title} className="size-20 rounded-md border border-line object-cover sm:size-24" />
                    </Link>
                    <div className="flex min-w-0 flex-1 flex-col">
                      <Link to={`/product/${l.productId}`} className="text-sm font-semibold hover:text-brand">
                        {l.title}
                      </Link>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                        <span>{titleCase(l.condition)}</span>
                        <span>· {titleCase(l.fulfillment)}</span>
                        <span>· {l.etaDays[0]}–{l.etaDays[1]} days</span>
                      </p>
                      {l.stock <= 5 && <Badge tone="warn" className="mt-1.5">Only {l.stock} left</Badge>}
                      <div className="mt-auto flex flex-wrap items-end justify-between gap-2 pt-2">
                        <div className="flex items-center rounded-md border border-line">
                          <button
                            className="flex size-8 items-center justify-center text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                            onClick={() => void change(l.offerId, l.qty - 1)}
                            disabled={busy}
                            aria-label="Decrease"
                          >
                            <Minus className="size-3" />
                          </button>
                          <span className="w-9 text-center text-sm font-semibold tabular-nums">{l.qty}</span>
                          <button
                            className="flex size-8 items-center justify-center text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                            onClick={() => void change(l.offerId, l.qty + 1)}
                            disabled={busy || l.qty >= Math.min(10, l.stock)}
                            aria-label="Increase"
                          >
                            <Plus className="size-3" />
                          </button>
                        </div>
                        <div className="text-right">
                          <p className="font-display text-sm font-bold">{birr(l.unitPrice * l.qty)}</p>
                          {l.qty > 1 && <p className="text-[10px] text-ink-3">{birr(l.unitPrice)} each</p>}
                        </div>
                      </div>
                    </div>
                    <button
                      className="h-fit shrink-0 rounded p-1 text-ink-3 hover:text-bad"
                      onClick={() => void change(l.offerId, 0)}
                      disabled={busy}
                      aria-label="Remove"
                    >
                      <X className="size-3.5" />
                    </button>
                  </div>
                ))}
              </div>
            </Card>
          ))}
        </div>

        <div className="space-y-4 lg:sticky lg:top-20 lg:self-start">
          <Card>
            <h2 className="mb-3 font-display text-base font-bold">Order summary</h2>
            <div className="border-b border-line pb-2">
              <KeyValue k="Subtotal" v={birr(data.totals.subtotal)} />
              <KeyValue k={`Delivery (${data.deliveryEstimate.min}–${data.deliveryEstimate.max} days)`} v={data.totals.delivery === 0 ? <Badge tone="ok">Free</Badge> : birr(data.totals.delivery)} />
              <KeyValue k="VAT (15%)" v={birr(data.totals.tax)} />
              <KeyValue k="Cash on delivery fee" v={birr(data.codFee)} />
              {data.promo && <KeyValue k={`Promotion · ${data.promo.code}`} v={<span className="text-ok">−{birr(data.promo.discount)}</span>} />}
            </div>
            <div className="flex items-baseline justify-between gap-3 pt-3">
              <span className="text-sm font-bold">Total</span>
              <span className="font-display text-xl font-bold">{birr(data.totals.total)}</span>
            </div>

            <Button
              block
              size="lg"
              variant="primary"
              className="mt-3"
              onClick={() => navigate('/checkout')}
              icon={<Package className="size-4" />}
            >
              Continue to checkout
            </Button>
            <p className="mt-2 text-center text-[10px] leading-relaxed text-ink-3">
              You will see the final total with VAT and delivery before you place the order.
            </p>
          </Card>

          <Card>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
              <Tag className="size-3.5 text-brand" /> Promotion code
            </p>
            <form onSubmit={applyPromo} className="flex gap-2">
              <input
                value={code}
                onChange={(e) => setCode(e.target.value.toUpperCase())}
                placeholder="SELAM10"
                className="h-9 min-w-0 flex-1 rounded-md border border-line bg-surface px-2.5 text-xs font-semibold uppercase focus:border-brand focus:outline-none"
              />
              <Button size="sm" type="submit" loading={busy}>Apply</Button>
            </form>
            <p className="mt-1.5 text-[10px] text-ink-3">Try SELAM10 for a demo discount on electronics.</p>
          </Card>

          <Card>
            <p className="mb-2 flex items-center gap-1.5 text-xs font-bold">
              <Truck className="size-3.5 text-brand" /> How delivery works
            </p>
            <ol className="space-y-1.5 text-[11px] leading-relaxed text-ink-2">
              <li>1. The seller packs and hands the parcel to a delivery agent.</li>
              <li>2. The agent calls you and you inspect the parcel before paying.</li>
              <li>3. Proof of delivery is captured — photo, signature or OTP.</li>
              <li>4. Only then does the seller's balance become payable.</li>
            </ol>
            <Textarea className="mt-2 hidden" rows={1} readOnly value="" />
          </Card>
        </div>
      </div>
    </div>
  );
}
