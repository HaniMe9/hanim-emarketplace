import { useState } from 'react';
import { Award, Info, Scale, TrendingUp, Zap } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { birr, pct } from '../../lib/format.ts';
import { Badge, Card, CardHeader, Empty, ErrorNote, Notice, Progress, Spinner, Stat, Tabs } from '../../components/ui.tsx';
import type { Fulfillment, Minor } from '../../../shared/types.ts';

type BuyBoxItem = {
  offerId: string;
  title: string;
  image: string;
  price: Minor;
  isBuyBox: boolean;
  reason: string;
  competitors: { id: string; price: Minor; seller?: string; fulfillment: Fulfillment; etaDays: number; stock: number }[];
};

const FULFIL_LABEL: Record<string, string> = {
  seller_fulfilled: 'You ship',
  fba: 'Warehouse',
  pickup: 'Collect',
};

export function SellerBuyBox() {
  const [tab, setTab] = useState('score');
  const { data, loading, error, reload } = useQuery<{
    items: BuyBoxItem[];
    explainer: string;
    weights: { name: string; weight: number }[];
  }>('/seller/buybox');

  if (loading) return <Spinner label="Loading Buy Box data…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const wins = data.items.filter((i) => i.isBuyBox).length;
  const totalWeight = data.weights.reduce((a, w) => a + w.weight, 0);

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Buy Box &amp; ranking</h1>
        <p className="mt-0.5 text-xs text-ink-3">Why you win or lose each product, with the weights shown.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat
          label="Buy Box wins"
          value={`${wins} / ${data.items.length}`}
          sub={data.items.length ? `${pct((wins / data.items.length) * 100, 0)} of your live catalogue` : undefined}
          tone="ok"
          icon={<Award className="size-4" />}
        />
        <Stat label="Live offers scored" value={String(data.items.length)} icon={<Scale className="size-4" />} />
        <Stat
          label="Biggest lever"
          value={data.weights[0]?.name ?? '—'}
          sub={`${data.weights[0]?.weight ?? 0}% of the score`}
          tone="gold"
          icon={<TrendingUp className="size-4" />}
        />
      </div>

      <Tabs
        tabs={[
          { id: 'score', label: 'Per-offer score' },
          { id: 'weights', label: 'Signal weights' },
          { id: 'sponsored', label: 'Sponsored layer' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'score' && (
        <div className="space-y-3">
          {data.items.length === 0 ? (
            <Empty title="No live offers" message="Once you have live listings, each one is scored here." />
          ) : (
            data.items.map((i) => {
              const cheapest = [i.price, ...i.competitors.map((c) => c.price)].sort((a, b) => a - b)[0];
              const cheapestIsYou = cheapest === i.price;
              return (
                <Card key={i.offerId} className={clsx(i.isBuyBox ? 'border-ok/30' : '')}>
                  <div className="flex flex-wrap items-start gap-3">
                    <img src={i.image} alt="" className="size-14 shrink-0 rounded-md border border-line object-cover" />
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{i.title}</span>
                        {i.isBuyBox ? (
                          <Badge tone="ok" icon={<Award className="size-3" />}>You hold the Buy Box</Badge>
                        ) : (
                          <Badge tone="muted">Outranked</Badge>
                        )}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        {birr(i.price)} · {i.competitors.length} competitor{i.competitors.length === 1 ? '' : 's'} on this
                        product
                      </p>
                      {!i.isBuyBox && (
                        <p className="mt-1.5 rounded border border-line bg-surface-2 p-2 text-[11px] leading-relaxed text-ink-2">
                          <b className="text-ink">Why: </b>
                          {i.reason}
                        </p>
                      )}
                    </div>
                  </div>

                  {i.competitors.length > 0 && (
                    <div className="mt-3 overflow-x-auto border-t border-line pt-3">
                      <table className="w-full min-w-[420px] text-left text-[11px]">
                        <thead>
                          <tr className="text-ink-3">
                            <th className="pb-1.5 font-semibold">Seller</th>
                            <th className="pb-1.5 font-semibold">Price</th>
                            <th className="pb-1.5 font-semibold">Fulfilment</th>
                            <th className="pb-1.5 font-semibold">ETA</th>
                            <th className="pb-1.5 font-semibold">Stock</th>
                          </tr>
                        </thead>
                        <tbody>
                          <tr className="border-t border-line/60 font-semibold">
                            <td className="py-1.5">You</td>
                            <td className="py-1.5 font-mono">{birr(i.price)}{cheapestIsYou && <span className="ml-1 text-ok">cheapest</span>}</td>
                            <td className="py-1.5">You ship</td>
                            <td className="py-1.5">—</td>
                            <td className="py-1.5">—</td>
                          </tr>
                          {i.competitors.map((c) => (
                            <tr key={c.id} className="border-t border-line/60 text-ink-2">
                              <td className="py-1.5">{c.seller ?? '—'}</td>
                              <td className="py-1.5 font-mono">
                                {birr(c.price)}
                                {c.price === cheapest && <span className="ml-1 text-warn">cheapest</span>}
                              </td>
                              <td className="py-1.5">{FULFIL_LABEL[c.fulfillment]}</td>
                              <td className="py-1.5">{c.etaDays}d</td>
                              <td className="py-1.5">{c.stock}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </Card>
              );
            })
          )}
        </div>
      )}

      {tab === 'weights' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_300px]">
          <Card>
            <CardHeader title="Scoring signals" subtitle="Weights sum to 100%. Changing a price moves one signal, not the answer." />
            <div className="space-y-2.5">
              {data.weights.map((w) => (
                <div key={w.name}>
                  <p className="mb-1 flex items-center justify-between text-[11px]">
                    <span className="font-semibold">{w.name}</span>
                    <span className="font-mono text-ink-3">{w.weight}%</span>
                  </p>
                  <Progress value={(w.weight / totalWeight) * 100} tone={w.weight >= 30 ? 'gold' : 'brand'} />
                </div>
              ))}
            </div>
          </Card>
          <div className="space-y-4">
            <Card>
              <CardHeader title="Why not just lowest price?" icon={<Info className="size-4" />} />
              <p className="text-[11px] leading-relaxed text-ink-2">{data.explainer}</p>
            </Card>
            <Notice tone="info" title="Rankings are auditable">
              Trust score, delivery reliability and performance are computed from real orders and delivery events. They
              cannot be self-reported, and no amount of money changes them.
            </Notice>
            <Notice tone="warn" title="Suspension is a real penalty">
              A late or failed COD delivery reduces your reliability signal immediately and can cost you the Buy Box on
              products you are winning on price alone.
            </Notice>
          </div>
        </div>
      )}

      {tab === 'sponsored' && <SponsoredLayer />}
    </div>
  );
}

function SponsoredLayer() {
  const { data, loading, error, reload } = useQuery<{
    eligible: boolean;
    reason?: string;
    active: { offerId: string; title?: string; clicks: number; orders: number; spend: Minor; cpc: Minor; ctr: number }[];
    packages: { id: string; label: string; daily: Minor; cpc: Minor; minRating: number; note: string }[];
    note: string;
  }>('/seller/promoted');

  if (loading) return <Spinner label="Loading sponsored placements…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <Notice tone="warn" title="Sponsored is a separate, labelled layer">{data.note}</Notice>

      {!data.eligible && (
        <Card className="border-warn/40">
          <p className="text-xs font-semibold text-warn">Not eligible yet</p>
          <p className="mt-1 text-[11px] text-ink-2">{data.reason}</p>
          <p className="mt-2 text-[11px] text-ink-3">
            Eligibility is a floor, not a payment. Sponsored placement is not a way to buy a better organic rank.
          </p>
        </Card>
      )}

      <div className="grid gap-3 lg:grid-cols-3">
        {data.packages.map((p) => (
          <Card key={p.id} className="p-0">
            <div className="border-b border-line p-3.5">
              <p className="flex items-center gap-1.5 text-sm font-bold">
                <Zap className="size-3.5 text-gold" /> {p.label}
              </p>
              <p className="mt-1 font-display text-lg font-bold">{birr(p.daily)}<span className="text-xs font-normal text-ink-3">/day</span></p>
              <p className="mt-0.5 text-[11px] text-ink-3">{birr(p.cpc)} per click · needs {p.minRating}★ rating</p>
            </div>
            <div className="p-3.5">
              <p className="text-[11px] text-ink-2">{p.note}</p>
              <a
                href="/seller/buy-box"
                className="mt-3 inline-flex items-center gap-1.5 text-[11px] font-semibold text-brand hover:underline"
              >
                Promote a listing <Zap className="size-3" />
              </a>
            </div>
          </Card>
        ))}
      </div>

      <Card>
        <CardHeader title="Active campaigns" subtitle="Every promoted impression is labelled in the buyer experience" />
        {data.active.length === 0 ? (
          <Empty icon={<Zap className="size-5" />} title="No campaigns running" message="Promoted placement is opt-in and budget-capped." />
        ) : (
          <div className="space-y-1.5">
            {data.active.map((a) => (
              <div key={a.offerId} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-2.5 text-[11px]">
                <span className="font-semibold">{a.title}</span>
                <span className="text-ink-3">{a.clicks} clicks · {a.orders} orders · {a.ctr}% CTR</span>
                <span className="font-mono">{birr(a.spend)}</span>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
