import { Link } from 'react-router-dom';
import {
  AlertTriangle, ArrowUpRight, Boxes, Brain, CheckCircle2, Clock, Package,
  ShoppingCart, Sparkles, Store, TrendingUp, Wallet, Zap,
} from 'lucide-react';
import { useQuery } from '../../lib/useQuery.ts';
import { birr, compact, dateOnly, dateTime, moneyShort, pct, statusLabel, titleCase } from '../../lib/format.ts';
import {
  Avatar, Badge, Button, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Progress, Spinner, Stat,
} from '../../components/ui.tsx';
import { OrderRow } from '../buyer/OrdersPage.tsx';
import type { AiSuggestion, Order, ReorderSuggestion, Settlement } from '../../../shared/types.ts';

interface SellerDashboard {
  seller: { id: string; name: string; nameAm: string; slug: string; tier: string; trustScore: number; badge?: string; published: boolean };
  metrics: {
    gmv30d: number; gmvDeltaPct: number; orders30d: number; ordersDeltaPct: number;
    conversionRate: number; conversionDeltaPct: number; views30d: number; avgOrderValue: number;
    cancelRate: number; lateShipRate: number; activeListings: number; pendingModeration: number;
    lowStockCount: number; unpaidBalance: number; nextSettlementAt: string;
  };
  buyBox: {
    offerId: string; productId: string; title: string; image: string; price: number;
    cheapestPrice: number; delta: number; isCheapest: boolean; isBuyBox: boolean;
    competitorCount: number; eligible: boolean; stock: number; promoted?: boolean; lostAt?: number;
  }[];
  orders: { needsAction: number; recent: Order[]; byStatus: Record<string, number> };
  finance: {
    availableBalance: number; pendingEscrow: number; commissionRate: number;
    lifetimeCommission: number; lifetimeSales: number;
    settlements: Settlement[]; payoutAccount: { bank: string; accountNumber: string; verified: boolean } | null;
  };
  reorder: ReorderSuggestion[];
  ai: AiSuggestion[];
  storePublication: {
    published: boolean;
    state: string;
    events: { key: string; at?: string; done: boolean; label: string }[];
  };
}

export function SellerDashboard() {
  const { data, loading, error, reload } = useQuery<SellerDashboard>('/seller/dashboard');

  if (loading) return <Spinner label="Loading your store…" />;
  if (error || !data) return <ErrorNote message={error ?? 'Could not load the seller dashboard.'} onRetry={reload} />;

  const m = data.metrics;
  const f = data.finance;
  const nextSettlement = data.finance.settlements.find((s) => s.status === 'ready' || s.status === 'accruing' || s.status === 'on_hold');
  const lostBuyBox = data.buyBox.filter((b) => !b.isBuyBox);

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-center gap-3">
          <Avatar name={data.seller.name} hue={180} size={44} />
          <div>
            <h1 className="font-display text-xl font-bold">{data.seller.name}</h1>
            <p className="mt-0.5 flex flex-wrap items-center gap-1.5 text-xs text-ink-3">
              {data.seller.badge && <Badge tone="gold">{data.seller.badge}</Badge>}
              <span>{titleCase(data.seller.tier)}</span>
              <span>· trust {Math.round(data.seller.trustScore)}</span>
              {data.storePublication.published ? (
                <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Store live</Badge>
              ) : (
                <Badge tone="warn">Store unpublished</Badge>
              )}
            </p>
          </div>
        </div>
        <div className="flex gap-2">
          <Link to="/seller/listings">
            <Button variant="secondary" icon={<Store className="size-4" />}>Listings</Button>
          </Link>
          <Link to="/seller/orders">
            <Button variant="primary" icon={<ShoppingCart className="size-4" />}>
              Orders{data.orders.needsAction > 0 ? ` (${data.orders.needsAction})` : ''}
            </Button>
          </Link>
        </div>
      </div>

      <Grid cols={5}>
        <Stat
          label="GMV · 30 days"
          value={moneyShort(m.gmv30d)}
          sub={`${m.orders30d} orders`}
          trend={{ value: m.gmvDeltaPct }}
          icon={<TrendingUp className="size-4" />}
          tone="brand"
        />
        <Stat
          label="Conversion"
          value={pct(m.conversionRate)}
          trend={{ value: m.conversionDeltaPct }}
          sub={`${compact(m.views30d)} views`}
          icon={<Zap className="size-4" />}
        />
        <Stat
          label="Available balance"
          value={moneyShort(f.availableBalance)}
          sub={`${moneyShort(f.pendingEscrow)} in escrow`}
          icon={<Wallet className="size-4" />}
          tone="ok"
        />
        <Stat
          label="Needs action"
          value={m.pendingModeration + m.lowStockCount + data.orders.needsAction}
          sub={`${m.pendingModeration} reviews · ${m.lowStockCount} low stock`}
          icon={<AlertTriangle className="size-4" />}
          tone={m.pendingModeration + m.lowStockCount + data.orders.needsAction > 0 ? 'warn' : 'muted'}
        />
        <Stat
          label="Next settlement"
          value={nextSettlement ? dateOnly(nextSettlement.periodTo) : '—'}
          sub={nextSettlement ? nextSettlement.status.replace(/_/g, ' ') : 'none scheduled'}
          icon={<Clock className="size-4" />}
          tone={nextSettlement?.status === 'blocked' ? 'bad' : nextSettlement?.status === 'on_hold' ? 'warn' : 'muted'}
        />
      </Grid>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        <div className="space-y-4">
          {/* orders needing action */}
          <Card>
            <CardHeader
              title="Orders that need you"
              subtitle="Fulfil within 48 hours or your on-time shipping rate drops"
              icon={<ShoppingCart className="size-4" />}
              action={<Link to="/seller/orders"><Button size="sm" variant="ghost" icon={<ArrowUpRight className="size-3.5" />}>All orders</Button></Link>}
            />
            {data.orders.recent.length === 0 ? (
              <Empty title="Nothing waiting" message="New orders will appear here the moment a buyer pays." />
            ) : (
              <div className="space-y-2">
                {data.orders.recent.slice(0, 5).map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </div>
            )}
            <div className="mt-3 flex flex-wrap gap-1.5 border-t border-line pt-3">
              {Object.entries(data.orders.byStatus).map(([k, v]) => (
                <Badge key={k} tone={v > 0 ? 'info' : 'muted'}>{statusLabel(k)} {v}</Badge>
              ))}
            </div>
          </Card>

          {/* buy box */}
          <Card>
            <CardHeader
              title="Buy Box performance"
              subtitle="Ranked on price, stock and seller performance — with a visible weight on each"
              icon={<Boxes className="size-4" />}
              action={<Link to="/seller/buybox"><Button size="sm" variant="ghost">How it works</Button></Link>}
            />
            {lostBuyBox.length > 0 && (
              <div className="mb-3 rounded-md border border-warn/25 bg-warn-soft/20 px-3 py-2 text-[11px] leading-relaxed text-warn">
                You are losing the Buy Box on {lostBuyBox.length} listing{lostBuyBox.length === 1 ? '' : 's'}. The most
                common reason is price, not promotion spend.
              </div>
            )}
            <div className="space-y-2">
              {data.buyBox.slice(0, 6).map((b) => (
                <div key={b.offerId} className="flex flex-wrap items-center gap-3 border-b border-line pb-2 last:border-0 last:pb-0">
                  <img src={b.image} alt="" className="size-10 shrink-0 rounded-md border border-line object-cover" />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-xs font-semibold">{b.title}</p>
                    <p className="mt-0.5 text-[10px] text-ink-3">
                      {b.competitorCount} competitor{b.competitorCount === 1 ? '' : 's'} · cheapest is {birr(b.cheapestPrice)}
                      {b.delta !== 0 && !b.isCheapest && ` · you are ${birr(Math.abs(b.delta))} ${b.delta > 0 ? 'above' : 'below'}`}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-1.5">
                    {!b.eligible && <Badge tone="bad">Not eligible</Badge>}
                    {b.promoted && <Badge tone="gold">Sponsored</Badge>}
                    {b.isBuyBox ? <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Winning</Badge> : <Badge tone="warn">Lost</Badge>}
                  </div>
                </div>
              ))}
            </div>
          </Card>

          {/* reorder */}
          {data.reorder.length > 0 && (
            <Card>
              <CardHeader
                title="Reorder suggestions"
                subtitle="Days of cover is a straight average of the last 30 days, not a forecast"
                icon={<Package className="size-4" />}
              />
              <div className="space-y-2.5">
                {data.reorder.map((r) => (
                  <div key={r.productId} className="rounded-md border border-line p-3">
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div className="min-w-0">
                        <p className="text-xs font-semibold">{r.title}</p>
                        <p className="mt-0.5 text-[10px] text-ink-3">{r.sku} · {r.supplierName}</p>
                      </div>
                      <Badge tone={r.daysOfCover < 7 ? 'bad' : r.daysOfCover < 14 ? 'warn' : 'ok'}>
                        {r.daysOfCover} days of cover
                      </Badge>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
                      <KeyValue k="On hand" v={r.onHand} />
                      <KeyValue k="Reorder at" v={r.reorderLevel} />
                      <KeyValue k="Avg daily" v={r.avgDailySales} />
                      <KeyValue k="Suggested" v={`${r.suggestedQty} units`} />
                    </div>
                    <Progress value={Math.min(100, (r.onHand / Math.max(1, r.reorderLevel * 3)) * 100)} tone={r.daysOfCover < 7 ? 'bad' : r.daysOfCover < 14 ? 'warn' : 'ok'} />
                    <p className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
                      {r.reasoning} Confidence {pct(r.confidence * 100, 0)} · {r.forecastMethod}
                      {r.baselineOnly && ' · baseline only, no seasonality applied'}
                    </p>
                  </div>
                ))}
              </div>
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {/* finance */}
          <Card>
            <CardHeader title="Money" icon={<Wallet className="size-4" />} />
            <KeyValue k="Available to withdraw" v={<span className="text-ok">{birr(f.availableBalance)}</span>} />
            <KeyValue k="Held in escrow" v={birr(f.pendingEscrow)} />
            <KeyValue k="Commission rate" v={pct(f.commissionRate * 100)} />
            <KeyValue k="Lifetime sales" v={birr(f.lifetimeSales)} />
            <KeyValue k="Lifetime commission" v={birr(f.lifetimeCommission)} />
            {f.payoutAccount && (
              <div className="mt-2 rounded-md bg-surface-2 px-2.5 py-2 text-[11px]">
                <p className="font-semibold">{f.payoutAccount.bank}</p>
                <p className="font-mono text-ink-3">••••{f.payoutAccount.accountNumber.slice(-4)}</p>
                <Badge tone={f.payoutAccount.verified ? 'ok' : 'warn'} className="mt-1">
                  {f.payoutAccount.verified ? 'Account verified' : 'Account not verified'}
                </Badge>
              </div>
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
              Escrow is released after proof of delivery and the settlement period closes. A cash shortfall at the
              delivery partner blocks the payout — it does not get quietly delayed.
            </p>
            <Link to="/seller/finance" className="mt-2 block">
              <Button block size="sm" variant="secondary">Open finance</Button>
            </Link>
          </Card>

          {/* AI */}
          <Card>
            <CardHeader
              title="AI assistant"
              subtitle={`${data.ai.length} suggestions, all guardrail-checked`}
              icon={<Brain className="size-4" />}
              action={<Link to="/seller/ai"><Button size="sm" variant="ghost"><Sparkles className="size-3.5" /></Button></Link>}
            />
            {data.ai.length === 0 ? (
              <Empty title="No suggestions yet" message="Ask for pricing or listing help and it will appear here." />
            ) : (
              <div className="space-y-2">
                {data.ai.slice(0, 3).map((a) => (
                  <div key={a.id} className="rounded-md border border-line p-2.5">
                    <p className="flex items-center gap-1.5 text-[10px] font-semibold text-ink-3">
                      {titleCase(a.capability)} · {a.latencyMs}ms
                      {a.applied ? <Badge tone="ok">Applied</Badge> : <Badge tone="muted">Not applied</Badge>}
                    </p>
                    <p className="mt-1 clamp-3 text-[11px] leading-relaxed text-ink-2">{a.output}</p>
                    <p className="mt-1 flex flex-wrap gap-1">
                      {a.guardrail.checks.map((c) => (
                        <Badge key={c.id} tone={c.result === 'pass' ? 'ok' : c.result === 'warn' ? 'warn' : 'bad'}>
                          {c.name}
                        </Badge>
                      ))}
                    </p>
                  </div>
                ))}
              </div>
            )}
          </Card>

          {/* publication */}
          <Card>
            <CardHeader title="Store visibility" icon={<Store className="size-4" />} />
            <KeyValue k="Status" v={data.storePublication.published ? <Badge tone="ok">Live</Badge> : <Badge tone="warn">Hidden</Badge>} />
            <KeyValue k="State" v={statusLabel(data.storePublication.state)} />
            {data.storePublication.events.slice(0, 3).map((e) => (
              <p key={e.key} className="mt-1.5 text-[10px] leading-relaxed text-ink-3">
                {e.done ? e.label : <span className="opacity-60">{e.label} — pending</span>}
                {e.at && ` · ${dateTime(e.at)}`}
              </p>
            ))}
          </Card>
        </div>
      </div>
    </div>
  );
}
