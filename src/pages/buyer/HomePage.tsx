import { Link } from 'react-router-dom';
import {
  ArrowRight, BadgeCheck, Boxes, Building2, MessageSquareText, Package,
  ShieldCheck, Sparkles, Truck, Wallet,
} from 'lucide-react';
import { useQuery } from '../../lib/useQuery.ts';
import { useSession } from '../../lib/session.tsx';
import { birr, compact } from '../../lib/format.ts';
import { t } from '../../lib/i18n/index.ts';
import { Badge, Button, Card, Dot, Grid, Spinner, Stat, ErrorNote } from '../../components/ui.tsx';
import { ProductGrid, ProductRow } from '../../components/ProductCard.tsx';
import { Assistant } from '../../components/Assistant.tsx';
import type { Category, ProductSummary, Review } from '../../../shared/types.ts';

interface Home {
  hero: { headline: string; sub: string; stats: { label: string; value: string }[] };
  categories: (Category & { children: Category[] })[];
  bestSellers: ProductSummary[];
  trending: ProductSummary[];
  newArrivals: ProductSummary[];
  deals: ProductSummary[];
  bulk: ProductSummary[];
  featuredSellers: {
    id: string; name: string; nameAm: string; slug: string; city: string; tier: string;
    trustScore: number; badge?: string; deliverySuccessRate: number; sales30d: number;
    topProducts: ProductSummary[];
  }[];
  reviews: Review[];
}

export function HomePage() {
  const { data, loading, error, reload } = useQuery<Home>('/home');
  const { session } = useSession();

  if (loading) return <Spinner label={t('Loading the marketplace…')} />;
  if (error || !data) return <ErrorNote message={error ?? t('Could not load the homepage.')} onRetry={reload} />;

  return (
    <div className="space-y-10">
      {/* hero */}
      <section className="card animate-rise relative overflow-hidden p-6 sm:p-8">
        <div className="grid-noise absolute inset-0 opacity-40" />
        <div className="relative grid gap-6 lg:grid-cols-[1.4fr_1fr] lg:items-center">
          <div>
            <Badge tone="brand" icon={<Sparkles className="size-3" />}>
              {t('B2C and B2B in one place')}
            </Badge>
            <h1 className="mt-3 font-display text-3xl leading-tight font-bold sm:text-4xl">{data.hero.headline}</h1>
            <p className="mt-2.5 max-w-xl text-sm leading-relaxed text-ink-2">{data.hero.sub}</p>
            <div className="mt-5 flex flex-wrap gap-2">
              <Link to="/search">
                <Button variant="primary" icon={<Boxes className="size-4" />}>{t('Browse products')}</Button>
              </Link>
              <Link to="/b2b">
                <Button variant="gold" icon={<Building2 className="size-4" />}>{t('Source wholesale')}</Button>
              </Link>
            </div>
            <dl className="mt-6 grid grid-cols-2 gap-4 sm:grid-cols-4">
              {data.hero.stats.map((s) => (
                <div key={s.label}>
                  <dt className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">{s.label}</dt>
                  <dd className="font-display text-lg font-bold text-ink">{s.value}</dd>
                </div>
              ))}
            </dl>
          </div>

          {/* assistant */}
          <Assistant />

        </div>
      </section>

      {/* trust strip */}
      <Grid cols={4}>
        <Stat label={t('Cash on delivery')} value={t('Nationwide')} sub={t('Collect at the door')} icon={<Wallet className="size-4" />} tone="brand" />
        <Stat label={t('Verified sellers')} value={t("KYC'd")} sub={t('Identity and licence checked')} icon={<BadgeCheck className="size-4" />} tone="ok" />
        <Stat label={t('Escrow holds')} value={t('Until POD')} sub={t('Capture ≠ payable')} icon={<ShieldCheck className="size-4" />} tone="gold" />
        <Stat label={t('Amharic support')} value="አማርኛ" sub="እና እግር መውድ" icon={<MessageSquareText className="size-4" />} tone="violet" />
      </Grid>

      {/* categories */}
      <Section title={t('Shop by category')} subtitle={t('{n} products across {m} departments', { n: compact(data.categories.reduce((a, c) => a + c.productCount, 0)), m: data.categories.length })}>
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {data.categories.map((c) => (
            <Link
              key={c.id}
              to={`/search?category=${c.slug}`}
              className="card flex flex-col items-center gap-2 p-4 text-center transition-colors hover:border-brand/40"
            >
              <span className="flex size-10 items-center justify-center rounded-full text-lg" style={{ background: c.accent + '1a' }}>
                {c.icon}
              </span>
              <span className="text-xs font-semibold text-ink">{c.name}</span>
              <span className="text-[10px] text-ink-3">{c.nameAm}</span>
              <span className="text-[10px] text-ink-3">{t('{n} items', { n: c.productCount })}</span>
            </Link>
          ))}
        </div>
      </Section>

      {data.deals.length > 0 && (
        <Section title={t("This week's deals")} subtitle={t('Real reductions, shown with the price they came from')}>
          <ProductGrid items={data.deals} />
        </Section>
      )}

      <Section title={t('Best sellers')} subtitle={t('What Ethiopian buyers actually order')} action={<Link to="/search?sort=sales"><Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />}>{t('See all')}</Button></Link>}>
        <ProductGrid items={data.bestSellers.slice(0, 10)} />
      </Section>

      <Section title={t('Trending now')} subtitle={t('High views in the last seven days')}>
        <ProductRow items={data.trending.slice(0, 10)} />
      </Section>

      <Section title={t('New arrivals')} subtitle={t('Listed in the last few weeks')}>
        <ProductRow items={data.newArrivals} />
      </Section>

      {data.bulk.length > 0 && (
        <Section title={t('Wholesale & bulk')} subtitle={t('Minimum order quantities with tier pricing')} action={<Link to="/b2b"><Button size="sm" variant="ghost" icon={<ArrowRight className="size-3.5" />}>{t('Open B2B')}</Button></Link>}>
          <ProductGrid items={data.bulk.slice(0, 5)} />
        </Section>
      )}

      {/* featured sellers */}
      <Section title={t('Verified sellers')} subtitle={t('Ranked by trust score, not by who paid the most')}>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {data.featuredSellers.map((s) => (
            <Card key={s.id} className="flex flex-col gap-3">
              <div className="flex items-start gap-3">
                <span
                  className="flex size-11 shrink-0 items-center justify-center rounded-lg font-display text-base font-bold text-white"
                  style={{ background: `hsl(${s.trustScore} 40% 32%)` }}
                >
                  {s.name.slice(0, 2).toUpperCase()}
                </span>
                <div className="min-w-0 flex-1">
                  <Link to={`/sellers/${s.slug}`} className="flex items-center gap-1.5 text-sm font-bold hover:text-brand">
                    <span className="truncate">{s.name}</span>
                    {s.badge && <Badge tone="ok">{s.badge}</Badge>}
                  </Link>
                  <p className="mt-0.5 text-[11px] text-ink-3">{s.city} · {t('trust {n}', { n: Math.round(s.trustScore) })}</p>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    <Badge tone="ok" icon={<Truck className="size-3" />}>{t('{n}% delivered', { n: s.deliverySuccessRate })}</Badge>
                    <Badge tone="muted">{t('{n} sales · 30d', { n: compact(s.sales30d / 100) })}</Badge>
                  </div>
                </div>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {s.topProducts.slice(0, 3).map((p) => (
                  <Link
                    key={p.id}
                    to={`/product/${p.slug}`}
                    className="max-w-full truncate rounded-md border border-line px-2 py-1 text-[11px] text-ink-2 transition-colors hover:border-brand/40 hover:text-brand"
                  >
                    {p.title} · <span className="font-semibold">{birr(p.price, { decimals: false })}</span>
                  </Link>
                ))}
              </div>
            </Card>
          ))}
        </div>
      </Section>

      {/* reviews */}
      {data.reviews.length > 0 && (
        <Section title={t('What buyers say')} subtitle={t('Only from verified purchases')}>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.reviews.map((r) => (
              <Card key={r.id}>
                <div className="mb-2 flex items-center justify-between gap-2">
                  <span className="flex items-center gap-2">
                    <Dot tone="ok" />
                    <span className="text-xs font-semibold">{r.authorName}</span>
                    {r.verifiedPurchase && <Badge tone="ok">{t('Verified purchase')}</Badge>}
                  </span>
                  <span className="text-[11px] text-gold">{'★'.repeat(r.rating)}</span>
                </div>
                <p className="text-sm font-semibold">{r.title}</p>
                <p className="mt-1 clamp-2 text-xs leading-relaxed text-ink-2">{r.body}</p>
                <p className="mt-2 flex items-center gap-1 text-[10px] text-ink-3">
                  <Package className="size-3" /> {t('{n} found this helpful', { n: r.helpfulCount })}
                </p>
              </Card>
            ))}
          </div>
        </Section>
      )}

      {!session?.org && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-brand/25 bg-brand-soft/30">
          <div>
            <p className="text-sm font-bold">{t('Buying for a business?')}</p>
            <p className="mt-0.5 text-xs text-ink-2">{t('Switch to a business buyer from the profile menu to see RFQs, credit terms and purchase orders.')}</p>
          </div>
          <Link to="/b2b">
            <Button variant="primary" icon={<Building2 className="size-4" />}>{t('Open the B2B desk')}</Button>
          </Link>
        </Card>
      )}
    </div>
  );
}

export function Section({
  title,
  subtitle,
  action,
  children,
}: {
  title: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section>
      <div className="mb-3.5 flex flex-wrap items-end justify-between gap-2">
        <div>
          <h2 className="font-display text-lg font-bold">{title}</h2>
          {subtitle && <p className="mt-0.5 text-xs text-ink-3">{subtitle}</p>}
        </div>
        {action}
      </div>
      {children}
    </section>
  );
}
