import { useEffect, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import {
  BadgeCheck, Building2, Check, Heart, Minus, Package, Plus, ShieldCheck,
  ShoppingCart, Star, Store, Truck, Undo2, Zap,
} from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { useSession, useUser } from '../../lib/session.tsx';
import { t } from '../../lib/i18n/index.ts';
import { birr, compact, dateOnly, enumLabel, etbAmount, money, pct } from '../../lib/format.ts';
import {
  Avatar, Badge, Button, Card, Dot, ErrorNote, Grid, KeyValue, Notice, Spinner, Tabs,
} from '../../components/ui.tsx';
import { ProductGrid } from '../../components/ProductCard.tsx';
import type { Category, OfferView, ProductSummary, Review } from '../../../shared/types.ts';

interface ProductDetail {
  id: string;
  slug: string;
  title: string;
  titleAm: string;
  description: string;
  brand?: string;
  attributes: Record<string, string>;
  images: string[];
  rating: number;
  reviewCount: number;
  soldCount: number;
  viewCount: number;
  tags: string[];
  createdAt: string;
  moq: number | null;
  category: Category;
  offers: OfferView[];
  buyBox: OfferView | null;
  buyBoxReason?: string;
  priceRange: [number, number];
  inStock: boolean;
  related: ProductSummary[];
  reviews: Review[];
  ratingBreakdown: { stars: number; count: number }[];
  relatedCategories: Category[];
  specSheet?: { label: string; value: string }[];
  b2bPricing: { moq: number; tiers: { minQty: number; price: number }[]; note?: string } | null;
}

type TabId = 'offers' | 'description' | 'specs' | 'reviews' | 'b2b' | 'shipping';

export function ProductPage() {
  const { idOrSlug = '' } = useParams();
  const { refresh } = useSession();
  const user = useUser();
  const { data, loading, error, reload } = useQuery<ProductDetail>(`/products/${idOrSlug}`);
  const [offerId, setOfferId] = useState<string | null>(null);
  const [qty, setQty] = useState(1);
  const [tab, setTab] = useState<TabId>('offers');
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [imageIdx, setImageIdx] = useState(0);

  useEffect(() => {
    if (data?.buyBox) setOfferId(data.buyBox.id);
  }, [data]);

  const live = data?.offers.filter((o) => o.status === 'live') ?? [];
  const selected = live.find((o) => o.id === offerId) ?? live[0] ?? null;
  const maxQty = Math.min(10, selected?.stock ?? 1);

  async function addToCart() {
    if (!selected) return;
    setAdding(true);
    setErr(null);
    try {
      await api.post('/cart', { offerId: selected.id, qty });
      await refresh();
      setToast(t('{n} × {title} added to your cart.', { n: qty, title: data!.title }));
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : t('Could not add to cart.'));
    } finally {
      setAdding(false);
    }
  }

  if (loading) return <Spinner label={t('Loading product…')} />;
  if (error || !data) return <ErrorNote message={error ?? t('Product not found.')} onRetry={reload} />;

  const savings = selected?.compareAtPrice && selected.compareAtPrice > selected.price
    ? selected.compareAtPrice - selected.price
    : 0;

  return (
    <div className="space-y-5">
      <nav className="flex flex-wrap items-center gap-1.5 text-[11px] text-ink-3">
        <Link to="/" className="hover:text-brand">{t('Home')}</Link>
        <span>/</span>
        <Link to={`/search?category=${data.category.slug}`} className="hover:text-brand">{data.category.name}</Link>
        {selected && (
          <>
            <span>/</span>
            <Link to={`/sellers/${selected.seller.slug}`} className="hover:text-brand">{selected.seller.name}</Link>
          </>
        )}
      </nav>

      {toast && <Notice tone="ok" title={t('Added')} onClose={() => setToast(null)}>{toast}</Notice>}
      {err && <ErrorNote message={err} />}

      {/*
        * `grid-cols-1` for the same reason as the seller order card: without it
        * the phone layout uses the implicit `auto` track, whose minimum is the
        * item's min-content width. A product title and the spec table beside it
        * are wider than 375px, so the track grew to 418px and the whole document
        * scrolled sideways. `minmax(0, 1fr)` caps the track at the column and lets
        * the text inside wrap.
        */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-[minmax(0,1fr)_380px]">
        {/* gallery */}
        <div className="min-w-0">
          <div className="card overflow-hidden">
            <div className="aspect-4/3 bg-surface-2">
              <img src={data.images[imageIdx] ?? data.images[0]} alt={data.title} className="size-full object-cover" />
            </div>
            {data.images.length > 1 && (
              <div className="flex gap-2 overflow-x-auto p-2.5">
                {data.images.map((img, i) => (
                  <button
                    key={img}
                    onClick={() => setImageIdx(i)}
                    className={clsx(
                      'size-16 shrink-0 overflow-hidden rounded-md border-2 transition-colors',
                      i === imageIdx ? 'border-brand' : 'border-transparent opacity-70 hover:opacity-100',
                    )}
                  >
                    <img src={img} alt="" className="size-full object-cover" />
                  </button>
                ))}
              </div>
            )}
          </div>

          <div className="mt-2 flex flex-wrap gap-1.5">
            {data.tags.map((tag) => (
              <Link key={tag} to={`/search?q=${encodeURIComponent(tag)}`}>
                <Badge tone="muted">#{tag}</Badge>
              </Link>
            ))}
          </div>
        </div>

        {/* buy box */}
        <div className="min-w-0 space-y-4">
          <div>
            <h1 className="font-display text-xl leading-snug font-bold sm:text-2xl">{data.title}</h1>
            <p className="mt-1 text-sm text-ink-2" lang="am">{data.titleAm}</p>

            <div className="mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs">
              <span className="flex items-center gap-1">
                <Star className="size-3.5 fill-gold text-gold" />
                <span className="font-bold">{data.rating.toFixed(1)}</span>
                <span className="text-ink-3">{t('{n} reviews', { n: data.reviewCount.toLocaleString() })}</span>
              </span>
              <span className="text-ink-3">·</span>
              <span className="text-ink-3">{t('{n} sold', { n: compact(data.soldCount) })}</span>
              <span className="text-ink-3">·</span>
              <span className="text-ink-3">{t('Listed {date}', { date: dateOnly(data.createdAt) })}</span>
            </div>
          </div>

          {live.length > 1 && (
            <p className="rounded-md border border-line bg-surface-2 px-3 py-2 text-[11px] text-ink-2">
              {t('{n} sellers offer this item, priced from', { n: live.length })}{' '}
              <span className="font-semibold">{birr(data.priceRange[1])}</span>
              {t('. The Buy Box is decided by price, stock and seller performance — not by who advertises hardest.')}
            </p>
          )}

          {selected && (
            <Card className="space-y-3">
              <div className="flex flex-wrap items-baseline gap-2">
                <span className="font-display text-3xl font-bold">{birr(selected.price)}</span>
                {savings > 0 && (
                  <>
                    <span className="text-sm text-ink-3 line-through">{birr(selected.compareAtPrice!)}</span>
                    <Badge tone="bad">{t('Save {amount}', { amount: birr(savings) })}</Badge>
                  </>
                )}
              </div>
              <p className="text-[11px] text-ink-3">{t('Prices exclude VAT. VAT at 15% is added at checkout.')}</p>

              {live.length > 1 && (
                <div>
                  <label className="mb-1.5 block text-xs font-semibold text-ink-2">{t('Choose a seller')}</label>
                  <div className="space-y-1.5">
                    {live.map((o) => {
                      const isWinner = data.buyBox?.id === o.id;
                      return (
                        <button
                          key={o.id}
                          onClick={() => setOfferId(o.id)}
                          className={clsx(
                            'flex w-full items-start gap-2.5 rounded-md border p-2.5 text-left transition-colors',
                            selected.id === o.id ? 'border-brand bg-brand-soft/30' : 'border-line hover:bg-surface-2',
                          )}
                        >
                          <span className="mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border-2 border-brand">
                            {selected.id === o.id && <span className="size-1.5 rounded-full bg-brand" />}
                          </span>
                          <span className="min-w-0 flex-1">
                            <span className="flex flex-wrap items-center gap-1.5">
                              <span className="truncate text-xs font-semibold">{o.seller.name}</span>
                              {o.seller.badge && <Badge tone="ok">{o.seller.badge}</Badge>}
                              {isWinner && <Badge tone="gold" icon={<Zap className="size-2.5" />}>{t('Buy Box')}</Badge>}
                              {o.promoted && <Badge tone="gold">{t('Sponsored')}</Badge>}
                            </span>
                            <span className="mt-0.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-[11px] text-ink-3">
                              <span className="font-semibold text-ink">{birr(o.price)}</span>
                              <span>· {enumLabel(o.condition)}</span>
                              <span>· {t('{a}–{b} days', { a: o.etaDays[0], b: o.etaDays[1] })}</span>
                              <span>· {t('{n} in stock', { n: o.stock })}</span>
                              <span>· {t('trust {n}', { n: Math.round(o.seller.trustScore) })}</span>
                            </span>
                            <span className="mt-0.5 block text-[10px] text-ink-3">{o.location}</span>
                          </span>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {data.buyBoxReason && (
                <p className="flex items-start gap-1.5 rounded-md bg-surface-2 px-2.5 py-2 text-[10px] leading-relaxed text-ink-2">
                  <ShieldCheck className="mt-0.5 size-3 shrink-0 text-brand" />
                  {data.buyBoxReason}
                </p>
              )}

              <div className="flex items-center gap-3">
                <span className="text-xs font-semibold text-ink-2">{t('Quantity')}</span>
                <div className="flex items-center rounded-md border border-line">
                  <button
                    className="flex size-9 items-center justify-center text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                    onClick={() => setQty((q) => Math.max(1, q - 1))}
                    disabled={qty <= 1}
                    aria-label={t('Decrease quantity')}
                  >
                    <Minus className="size-3.5" />
                  </button>
                  <span className="w-10 text-center text-sm font-semibold tabular-nums">{qty}</span>
                  <button
                    className="flex size-9 items-center justify-center text-ink-2 hover:bg-surface-2 disabled:opacity-40"
                    onClick={() => setQty((q) => Math.min(maxQty, q + 1))}
                    disabled={qty >= maxQty}
                    aria-label={t('Increase quantity')}
                  >
                    <Plus className="size-3.5" />
                  </button>
                </div>
                {selected.stock < 10 && <Badge tone="warn">{t('Only {n} left', { n: selected.stock })}</Badge>}
              </div>

              <div className="space-y-2">
                <Button
                  block
                  size="lg"
                  variant="primary"
                  loading={adding}
                  disabled={!data.inStock}
                  onClick={addToCart}
                  icon={<ShoppingCart className="size-4" />}
                >
                  {t('Add to cart')} · {birr(selected.price * qty, { decimals: false })}
                </Button>
                <Button block variant="secondary" icon={<Zap className="size-4" />}>
                  {t('Buy now')}
                </Button>
                <Button block variant="ghost" icon={<Heart className="size-4" />}>{t('Save for later')}</Button>
              </div>

              <div className="space-y-1.5 border-t border-line pt-3">
                <p className="flex items-center gap-2 text-[11px] text-ink-2">
                  <Truck className="size-3.5 shrink-0 text-brand" />
                  {t('Delivered in {a}–{b} days to most cities', { a: selected.etaDays[0], b: selected.etaDays[1] })}
                </p>
                <p className="flex items-center gap-2 text-[11px] text-ink-2">
                  <Package className="size-3.5 shrink-0 text-brand" />
                  {enumLabel(selected.fulfillment)} · {selected.location}
                </p>
                <p className="flex items-center gap-2 text-[11px] text-ink-2">
                  <ShieldCheck className="size-3.5 shrink-0 text-brand" />
                  {t('Funds held in escrow until delivery is confirmed')}
                </p>
              </div>

              {user.role === 'business_buyer' && data.moq && (
                <Notice tone="gold" title={t('Wholesale available')}>
                  {t('Minimum order {n} units. Tier pricing applies automatically at checkout.', { n: data.moq })}
                </Notice>
              )}
            </Card>
          )}

          {selected && (
            <Link to={`/sellers/${selected.seller.slug}`} className="card flex items-center gap-3 p-3.5 transition-colors hover:border-brand/40">
              <Avatar name={selected.seller.name} hue={selected.seller.trustScore} size={40} />
              <div className="min-w-0 flex-1">
                <p className="flex items-center gap-1.5 text-sm font-bold">
                  <span className="truncate">{selected.seller.name}</span>
                  <BadgeCheck className="size-3.5 shrink-0 text-ok" />
                </p>
                <p className="truncate text-[11px] text-ink-3">{selected.seller.city} · {t('trust {n}', { n: Math.round(selected.seller.trustScore) })}</p>
              </div>
              <Badge tone="ok">{t('{n}% delivered', { n: pct(selected.seller.deliverySuccessRate) })}</Badge>
            </Link>
          )}
        </div>
      </div>

      {/* tabs */}
      <div>
        <Tabs
          value={tab}
          onChange={setTab}
          tabs={[
            { id: 'offers', label: t('Sellers ({n})', { n: live.length }) },
            { id: 'description', label: t('Description') },
            { id: 'specs', label: t('Specifications') },
            { id: 'reviews', label: t('Reviews'), count: data.reviews.length },
            ...(data.b2bPricing ? [{ id: 'b2b' as TabId, label: t('Wholesale') }] : []),
            { id: 'shipping', label: t('Delivery & returns') },
          ]}
        />

        <div className="pt-4">
          {tab === 'offers' && (
            <div className="space-y-2">
              {live.map((o) => (
                <Card key={o.id} className="flex flex-wrap items-center justify-between gap-3">
                  <div className="flex min-w-0 items-center gap-3">
                    <Avatar name={o.seller.name} hue={o.seller.trustScore} size={36} />
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-1.5 text-sm font-semibold">
                        <span className="truncate">{o.seller.name}</span>
                        {o.seller.badge && <Badge tone="ok">{o.seller.badge}</Badge>}
                        {data.buyBox?.id === o.id && <Badge tone="gold">{t('Buy Box')}</Badge>}
                      </p>
                      <p className="mt-0.5 flex flex-wrap gap-x-2 text-[11px] text-ink-3">
                        <span>★ {o.rating.toFixed(1)}</span>
                        <span>· {t('{n} in stock', { n: o.stock })}</span>
                        <span>· {enumLabel(o.condition)}</span>
                        <span>· {t('{a}–{b} days', { a: o.etaDays[0], b: o.etaDays[1] })}</span>
                        <span>· {o.location}</span>
                      </p>
                    </div>
                  </div>
                  <div className="flex items-center gap-3">
                    <span className="font-display text-lg font-bold">{birr(o.price)}</span>
                    <Button
                      size="sm"
                      variant={data.buyBox?.id === o.id ? 'primary' : 'secondary'}
                      onClick={() => {
                        setOfferId(o.id);
                        setQty(1);
                        setToast(t('Selected {seller}. Add to cart when ready.', { seller: o.seller.name }));
                      }}
                    >
                      {data.buyBox?.id === o.id ? <><Check className="size-3.5" /> {t('Selected')}</> : t('Select')}
                    </Button>
                  </div>
                </Card>
              ))}
            </div>
          )}

          {tab === 'description' && (
            <Card>
              <p className="text-sm leading-relaxed text-ink-2">{data.description}</p>
              <p className="mt-3 text-sm leading-relaxed text-ink-2" lang="am">{data.titleAm}</p>
            </Card>
          )}

          {tab === 'specs' && (
            <Card>
              <dl className="grid gap-x-8 sm:grid-cols-2">
                {Object.entries(data.attributes).map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                    <dt className="text-xs text-ink-3">{k}</dt>
                    <dd className="text-right text-xs font-semibold">{v}</dd>
                  </div>
                ))}
                {data.specSheet?.map((s) => (
                  <div key={s.label} className="flex items-baseline justify-between gap-4 border-b border-line py-2">
                    <dt className="text-xs text-ink-3">{s.label}</dt>
                    <dd className="text-right text-xs font-semibold">{s.value}</dd>
                  </div>
                ))}
              </dl>
            </Card>
          )}

          {tab === 'reviews' && (
            <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
              <Card>
                <p className="font-display text-3xl font-bold">{data.rating.toFixed(1)}</p>
                <p className="text-xs text-gold">{'★'.repeat(Math.round(data.rating))}{'☆'.repeat(5 - Math.round(data.rating))}</p>
                <p className="mt-1 text-[11px] text-ink-3">{t('{n} reviews', { n: data.reviewCount.toLocaleString() })}</p>
                <div className="mt-3 space-y-1.5">
                  {data.ratingBreakdown.map((b) => (
                    <div key={b.stars} className="flex items-center gap-2 text-[11px]">
                      <span className="w-8 shrink-0 text-ink-3">{b.stars}★</span>
                      <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <div className="h-full rounded-full bg-gold" style={{ width: `${data.reviewCount ? (b.count / data.reviewCount) * 100 : 0}%` }} />
                      </div>
                      <span className="w-8 shrink-0 text-right tabular-nums text-ink-3">{b.count}</span>
                    </div>
                  ))}
                </div>
                <p className="mt-3 text-[10px] leading-relaxed text-ink-3">
                  {t('Only buyers who received the item can review it. Reviews are held for a trust check before publication, and are never bought or edited by the seller.')}
                </p>
              </Card>
              <div className="space-y-3">
                {data.reviews.map((r) => (
                  <Card key={r.id}>
                    <div className="mb-1.5 flex flex-wrap items-center justify-between gap-2">
                      <span className="flex items-center gap-2">
                        <span className="text-xs font-semibold">{r.authorName}</span>
                        {r.verifiedPurchase && <Badge tone="ok">{t('Verified purchase')}</Badge>}
                      </span>
                      <span className="text-[11px] text-gold">{'★'.repeat(r.rating)}</span>
                    </div>
                    <p className="text-sm font-semibold">{r.title}</p>
                    <p className="mt-1 text-xs leading-relaxed text-ink-2">{r.body}</p>
                    <p className="mt-2 text-[10px] text-ink-3">
                      {dateOnly(r.createdAt)} · {t('{n} found this helpful', { n: r.helpfulCount })}
                    </p>
                  </Card>
                ))}
              </div>
            </div>
          )}

          {tab === 'b2b' && data.b2bPricing && (
            <Card>
              <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
                <Building2 className="size-4 text-brand" /> {t('Wholesale pricing')}
              </p>
              <Notice tone="info" title={t('Minimum order {n} units', { n: data.b2bPricing.moq })}>
                {data.b2bPricing.note ?? t('Tier prices apply automatically. No negotiation needed, and no buyer is quoted a different price for the same volume.')}
              </Notice>
              <div className="mt-3 space-y-1.5">
                {data.b2bPricing.tiers.map((tier, i) => (
                  <div key={tier.minQty} className={clsx('flex items-center justify-between rounded-md border px-3 py-2 text-sm', i === 0 ? 'border-brand bg-brand-soft/30' : 'border-line')}>
                    <span className="font-semibold">{t('{n}+ units', { n: tier.minQty })}</span>
                    <span className="font-display font-bold">{birr(tier.price)}</span>
                  </div>
                ))}
              </div>
              <Link to="/b2b" className="mt-3 block">
                <Button block variant="primary">{t('Open the B2B desk')}</Button>
              </Link>
            </Card>
          )}

          {tab === 'shipping' && (
            <Grid cols={3}>
              <Card>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Truck className="size-4 text-brand" /> {t('Delivery')}</p>
                <KeyValue k={t('Cash on delivery')} v={t('Nationwide')} />
                <KeyValue k={t('Fee')} v={birr(45000)} />
                <KeyValue k={t('Typical')} v={t('{a}–{b} days', { a: 1, b: 4 })} />
                <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                  {t('You can inspect the parcel before paying the agent. The agent’s cash is reconciled against the remittance, not against what they claim they collected.')}
                </p>
              </Card>
              <Card>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Undo2 className="size-4 text-brand" /> {t('Returns')}</p>
                <KeyValue k={t('Window')} v={t('{n} days', { n: 7 })} />
                <KeyValue k={t('Condition')} v={t('As delivered')} />
                <KeyValue k={t('Refund to')} v={t('Original method')} />
                <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                  {t('Open a dispute from the order page with photos. Funds stay in escrow until it is decided, and decisions carry a written reason.')}
                </p>
              </Card>
              <Card>
                <p className="mb-2 flex items-center gap-1.5 text-sm font-bold"><Store className="size-4 text-brand" /> {t('Seller promise')}</p>
                <KeyValue k={t('Escrow')} v={t('Until POD')} />
                <KeyValue k={t('Trust score')} v={selected ? `${Math.round(selected.seller.trustScore)}/100` : '—'} />
                <KeyValue k={t('Dispute rate')} v={selected ? pct(selected.seller.disputeRate) : '—'} />
                <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                  {t('Trust score blends delivery success, cancellations, disputes and verification tier. It is not purchasable.')}
                </p>
              </Card>
            </Grid>
          )}
        </div>
      </div>

      {data.related.length > 0 && (
        <section>
          <h2 className="mb-3 font-display text-lg font-bold">{t('Customers also compared')}</h2>
          <ProductGrid items={data.related.slice(0, 5)} />
        </section>
      )}

      <p className="flex items-center justify-center gap-1.5 pt-2 text-[10px] text-ink-3">
        <Dot tone="muted" />
        {t('Total you will pay at checkout:')}{' '}
        <span className="font-semibold">{selected ? etbAmount(selected.price * qty) : money(0)}</span>
        {t(' before VAT and delivery.')}
      </p>
    </div>
  );
}
