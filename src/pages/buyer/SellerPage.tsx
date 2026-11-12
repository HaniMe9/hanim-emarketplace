import { useParams } from 'react-router-dom';
import { BadgeCheck, Clock, ShieldCheck, Star, XCircle } from 'lucide-react';
import { useQuery } from '../../lib/useQuery.ts';
import { compact, dateOnly, pct } from '../../lib/format.ts';
import { Avatar, Badge, Card, ErrorNote, Grid, KeyValue, Progress, Spinner } from '../../components/ui.tsx';
import { ProductGrid } from '../../components/ProductCard.tsx';
import type { Organization, ProductSummary, Review } from '../../../shared/types.ts';

interface SellerDetail {
  seller: Organization;
  items: ProductSummary[];
  reviews: Review[];
  performance: {
    deliverySuccessRate: number;
    cancellationRate: number;
    disputeRate: number;
    responseTimeHours: number;
    rating: number;
    reviewCount: number;
    ordersCompleted: number;
    onTimeShipRate: number;
  };
}

const TIER_LABEL: Record<string, string> = {
  none: 'Unverified',
  basic: 'Basic verified',
  business: 'Business verified',
  trusted: 'Trusted',
  enterprise: 'Enterprise',
};

export function SellerPage() {
  const { id = '' } = useParams();
  const { data, loading, error, reload } = useQuery<SellerDetail>(`/sellers/${id}`);

  if (loading) return <Spinner label="Loading seller…" />;
  if (error || !data) return <ErrorNote message={error ?? 'Seller not found.'} onRetry={reload} />;

  const s = data.seller;
  const p = data.performance;

  return (
    <div className="space-y-5">
      <Card className="relative overflow-hidden">
        <div className="grid-noise absolute inset-0 opacity-30" />
        <div className="relative flex flex-wrap items-start gap-4">
          <Avatar name={s.name} hue={s.hue} size={64} />
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="font-display text-xl font-bold">{s.name}</h1>
              {s.badge && <Badge tone="gold">{s.badge}</Badge>}
              {s.tier !== 'none' && (
                <Badge tone="ok" icon={<BadgeCheck className="size-3" />}>{TIER_LABEL[s.tier]}</Badge>
              )}
              {s.suspended && <Badge tone="bad">Suspended</Badge>}
            </div>
            <p className="mt-0.5 text-sm text-ink-2" lang="am">{s.nameAm}</p>
            <p className="mt-1 text-xs text-ink-3">
              {s.city}, {s.region} · selling since {dateOnly(s.joinedAt)} · {compact(s.sales30d / 100)} sales in 30 days
            </p>
            <p className="mt-2.5 max-w-2xl text-sm leading-relaxed text-ink-2">{s.description}</p>
            <div className="mt-3 flex flex-wrap gap-1.5">
              <Badge tone="ok" icon={<Star className="size-3" />}>{s.rating.toFixed(1)} from {s.reviewCount.toLocaleString()} reviews</Badge>
              <Badge tone="brand">Trust score {Math.round(s.trustScore)}/100</Badge>
              <Badge tone="muted" icon={<Clock className="size-3" />}>Replies in {p.responseTimeHours}h</Badge>
            </div>
          </div>
          <div className="text-right">
            <p className="text-[10px] font-semibold tracking-wide text-ink-3 uppercase">Contact</p>
            <p className="text-xs font-semibold">{s.phone}</p>
            <p className="text-[11px] text-ink-3">{s.email}</p>
          </div>
        </div>
      </Card>

      <Grid cols={4}>
        <Card>
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Delivered successfully</p>
          <p className="mt-1.5 font-display text-2xl font-bold text-ok">{pct(p.deliverySuccessRate)}</p>
          <Progress value={p.deliverySuccessRate} tone="ok" />
          <p className="mt-1.5 text-[10px] text-ink-3">{compact(p.ordersCompleted)} orders completed</p>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Ships on time</p>
          <p className="mt-1.5 font-display text-2xl font-bold">{pct(p.onTimeShipRate)}</p>
          <Progress value={p.onTimeShipRate} tone={p.onTimeShipRate >= 90 ? 'ok' : 'warn'} />
          <p className="mt-1.5 text-[10px] text-ink-3">Packing deadline is 48 hours</p>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Cancellation rate</p>
          <p className={clsxNum(p.cancellationRate, 'font-display mt-1.5 text-2xl font-bold')}>{pct(p.cancellationRate)}</p>
          <Progress value={Math.min(100, p.cancellationRate * 10)} tone={p.cancellationRate < 3 ? 'ok' : 'bad'} />
          <p className="mt-1.5 text-[10px] text-ink-3">Cancelling after payment is penalised</p>
        </Card>
        <Card>
          <p className="text-[11px] font-semibold tracking-wide text-ink-3 uppercase">Dispute rate</p>
          <p className={clsxNum(p.disputeRate, 'font-display mt-1.5 text-2xl font-bold')}>{pct(p.disputeRate)}</p>
          <Progress value={Math.min(100, p.disputeRate * 20)} tone={p.disputeRate < 2 ? 'ok' : 'warn'} />
          <p className="mt-1.5 text-[10px] text-ink-3">Share of orders that became a case</p>
        </Card>
      </Grid>

      <NoticeAboutTrust tier={s.tier} />

      <section>
        <div className="mb-3.5 flex items-end justify-between gap-2">
          <div>
            <h2 className="font-display text-lg font-bold">What {s.name} sells</h2>
            <p className="mt-0.5 text-xs text-ink-3">{data.items.length} listings</p>
          </div>
        </div>
        <ProductGrid items={data.items} />
      </section>

      {data.reviews.length > 0 && (
        <section>
          <h2 className="mb-3.5 font-display text-lg font-bold">Recent reviews</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {data.reviews.map((r) => (
              <Card key={r.id}>
                <div className="mb-1.5 flex items-center justify-between gap-2">
                  <span className="text-xs font-semibold">{r.authorName}</span>
                  <span className="text-[11px] text-gold">{'★'.repeat(r.rating)}</span>
                </div>
                <p className="text-sm font-semibold">{r.title}</p>
                <p className="mt-1 clamp-3 text-xs leading-relaxed text-ink-2">{r.body}</p>
                <p className="mt-2 text-[10px] text-ink-3">
                  {dateOnly(r.createdAt)}{r.verifiedPurchase && ' · verified purchase'}
                </p>
              </Card>
            ))}
          </div>
        </section>
      )}

      <Card>
        <p className="mb-2.5 flex items-center gap-1.5 text-sm font-bold">
          <ShieldCheck className="size-4 text-brand" /> How the trust score works
        </p>
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <KeyValue k="Verification tier" v={TIER_LABEL[s.tier]} />
            <KeyValue k="Delivery success" v={pct(p.deliverySuccessRate)} />
            <KeyValue k="On-time shipping" v={pct(p.onTimeShipRate)} />
          </div>
          <div>
            <KeyValue k="Cancellations" v={pct(p.cancellationRate)} />
            <KeyValue k="Disputes" v={pct(p.disputeRate)} />
            <KeyValue k="Response time" v={`${p.responseTimeHours}h`} />
          </div>
        </div>
        <p className="mt-2.5 text-[10px] leading-relaxed text-ink-3">
          These are observed outcomes, not self-declared. A seller cannot buy a badge, edit a review, or pay to
          remove a dispute from their rate.
        </p>
      </Card>
    </div>
  );
}

function NoticeAboutTrust({ tier }: { tier: string }) {
  if (tier === 'none') {
    return (
      <Card className="border-warn/30 bg-warn-soft/15">
        <p className="flex items-center gap-1.5 text-sm font-bold text-warn">
          <XCircle className="size-4" /> This seller is not verified
        </p>
        <p className="mt-1 text-xs leading-relaxed text-ink-2">
          Identity and licence have not been checked. Cash on delivery is still recommended over sending money
          first, and disputes are harder to win without a verified counterparty on the other side.
        </p>
      </Card>
    );
  }
  return (
    <Card className="border-ok/25 bg-ok-soft/15">
      <p className="flex items-center gap-1.5 text-sm font-bold text-ok">
        <BadgeCheck className="size-4" /> {TIER_LABEL[tier]}
      </p>
      <p className="mt-1 text-xs leading-relaxed text-ink-2">
        Identity documents, business licence and bank account were checked. Verification is re-checked yearly, and
        a tier can be downgraded if delivery performance slips.
      </p>
    </Card>
  );
}

function clsxNum(value: number, base: string): string {
  return `${base} ${value < 3 ? 'text-ok' : 'text-bad'}`;
}
