import { useState } from 'react';
import { Activity, AlertTriangle, Banknote, CheckCircle2, Globe, Package, Radio, Scale, Wallet } from 'lucide-react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Cell, Legend, Pie, PieChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQuery } from '../../lib/useQuery.ts';
import { ago, birr, moneyShort, num, pct } from '../../lib/format.ts';
import { Badge, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Notice, Spinner, Stat, StatusBadge, Tabs } from '../../components/ui.tsx';
import type { JournalEntry, Minor, PlatformMetrics } from '../../../shared/types.ts';

type Health = {
  deliverySuccess: number;
  disputeRate: number;
  disputeOpen: number;
  verificationBacklog: number;
  listingsPending: number;
  ledgerBalanced: boolean;
  codOutstanding: Minor;
  codDepositsShort: number;
  codShortAmount: Minor;
  cashReconciliationGap: number;
  pspSuccess: number;
  agentsOffline: number;
  syncQueuePending: number;
};

type Platform = {
  metrics: PlatformMetrics;
  gmv: { gmv30d: Minor; netRevenue30d: Minor; takeRate: number; aov: Minor; sellerSales30d: Minor; note: string };
  health: Health;
  breakdown: Record<string, number>;
  ledger: { entries: number; balanced: boolean; trialBalance: { debit: Minor; credit: Minor }; lastEntry: JournalEntry | null };
  activity: { id: string; at: string; actor: string; action: string; entity: string; entityId: string; detail: string }[];
  incidents: { id: string; severity: 'info' | 'warn' | 'critical'; title: string; at: string; status: string; note: string }[];
};

const CHART = { stroke: 'var(--color-line)', fontSize: 10, tickLine: false, axisLine: false } as const;
const PIE = ['var(--color-brand)', 'var(--color-gold)', 'var(--color-ok)', 'var(--color-violet)', 'var(--color-warn)', 'var(--color-ink-3)'];

export function AdminPlatform() {
  const [tab, setTab] = useState('overview');
  const { data, loading, error, reload } = useQuery<Platform>('/admin/platform');

  if (loading) return <Spinner label="Loading platform…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { gmv, health, breakdown, ledger } = data;
  const series = data.metrics.series.slice(-14);
  const alerts: { label: string; value: string; tone: 'bad' | 'warn' | 'ok'; detail: string }[] = [
    { label: 'Ledger', value: ledger.balanced ? 'Balanced' : 'OUT OF BALANCE', tone: ledger.balanced ? 'ok' : 'bad', detail: `${ledger.entries} journal entries, trial balance Dr ${birr(ledger.trialBalance.debit)} = Cr ${birr(ledger.trialBalance.credit)}` },
    { label: 'COD remittance', value: health.codDepositsShort > 0 ? `${birr(health.codShortAmount)} short` : 'Reconciled', tone: health.codDepositsShort > 0 ? 'bad' : 'ok', detail: `${health.codDepositsShort} deposit(s) short; ${birr(health.codOutstanding)} collected but unremitted` },
    { label: 'PSP', value: `${health.pspSuccess}% capture success`, tone: health.pspSuccess >= 99 ? 'ok' : 'warn', detail: 'Fallback provider engages automatically below threshold' },
    { label: 'Offline agents', value: String(health.agentsOffline), tone: health.agentsOffline === 0 ? 'ok' : 'warn', detail: `${health.syncQueuePending} item(s) queued for sync` },
    { label: 'Disputes', value: `${health.disputeOpen} open`, tone: health.disputeOpen === 0 ? 'ok' : 'warn', detail: `${health.disputeRate}% of all orders; funds stay in escrow until resolved` },
    { label: 'Review backlog', value: `${health.listingsPending} listings · ${health.verificationBacklog} KYC`, tone: 'warn', detail: 'Nothing goes live or gets a tier badge without a human decision' },
  ];

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Platform</h1>
          <p className="mt-0.5 text-xs text-ink-3">Marketplace health, money position and the queues that need a human.</p>
        </div>
        <Badge tone={ledger.balanced ? 'ok' : 'bad'} icon={ledger.balanced ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}>
          Ledger {ledger.balanced ? 'balanced' : 'broken'}
        </Badge>
      </div>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'health', label: 'Health checks' },
          { id: 'ledger', label: 'Money & ledger' },
          { id: 'activity', label: 'Activity' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'overview' && (
        <div className="space-y-4">
          <Grid cols={4}>
            <Stat label="GMV 30d" value={moneyShort(gmv.gmv30d)} sub={`${num(data.metrics.orders30d)} orders`} tone="brand" icon={<Banknote className="size-4" />} />
            <Stat label="Net revenue 30d" value={moneyShort(gmv.netRevenue30d)} sub={`${gmv.takeRate}% take rate`} tone="ok" icon={<Scale className="size-4" />} />
            <Stat label="Avg order value" value={birr(gmv.aov)} sub={`COD ${pct(data.metrics.codRatio, 0)} of orders`} icon={<Package className="size-4" />} />
            <Stat label="Escrow held" value={moneyShort(data.metrics.escrowBalance)} sub="Buyer and seller money in transit" tone="gold" icon={<Wallet className="size-4" />} />
          </Grid>

          <Notice tone="info" title="Revenue model">{gmv.note}</Notice>

          <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
            <Card>
              <CardHeader title="GMV and order volume" subtitle="Last 14 days" />
              <div className="h-56">
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={series} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
                    <defs>
                      <linearGradient id="gmvFill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.3} />
                        <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid {...CHART} vertical={false} />
                    <XAxis dataKey="date" {...CHART} tickFormatter={(v: string) => v.slice(5)} />
                    <YAxis {...CHART} tickFormatter={(v: number) => moneyShort(v)} />
                    <Tooltip formatter={(v, n) => (n === 'gmv' ? birr(Number(v)) : num(Number(v)))} />
                    <Legend wrapperStyle={{ fontSize: 10 }} />
                    <Area type="monotone" dataKey="gmv" name="GMV" stroke="var(--color-brand)" strokeWidth={2} fill="url(#gmvFill)" />
                    <Area type="monotone" dataKey="orders" name="Orders" stroke="var(--color-gold)" strokeWidth={1.5} fill="none" />
                  </AreaChart>
                </ResponsiveContainer>
              </div>
            </Card>

            <Card>
              <CardHeader title="Category mix" icon={<Globe className="size-4" />} />
              <div className="h-40">
                <ResponsiveContainer width="100%" height="100%">
                  <PieChart>
                    <Pie data={data.metrics.categoryMix} dataKey="gmv" nameKey="name" innerRadius={38} outerRadius={58} paddingAngle={2}>
                      {data.metrics.categoryMix.map((_, i) => (
                        <Cell key={i} fill={PIE[i % PIE.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={(v) => birr(Number(v))} />
                  </PieChart>
                </ResponsiveContainer>
              </div>
              <div className="mt-1 space-y-1">
                {data.metrics.categoryMix.map((c, i) => (
                  <p key={c.name} className="flex items-center gap-1.5 text-[11px]">
                    <span className="size-2 rounded-full" style={{ background: PIE[i % PIE.length] }} />
                    <span className="flex-1">{c.name}</span>
                    <span className="text-ink-3">{pct(c.share, 0)}</span>
                  </p>
                ))}
              </div>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card>
              <CardHeader title="Where demand is" icon={<Globe className="size-4" />} />
              <div className="h-44">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={data.metrics.cities.slice(0, 7)} layout="vertical" margin={{ top: 0, right: 8, left: 0, bottom: 0 }}>
                    <CartesianGrid {...CHART} horizontal={false} />
                    <XAxis type="number" {...CHART} />
                    <YAxis type="category" dataKey="name" {...CHART} width={80} />
                    <Tooltip />
                    <Bar dataKey="orders" name="Orders" fill="var(--color-brand)" radius={[0, 3, 3, 0]} barSize={12} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            </Card>
            <Card>
              <CardHeader title="Marketplace counts" />
              <div className="grid grid-cols-2 gap-x-4 sm:grid-cols-3">
                {Object.entries(breakdown)
                  .filter(([k]) => !['stops', 'failedStops'].includes(k))
                  .map(([k, v]) => (
                    <KeyValue key={k} k={k.replace(/([A-Z])/g, ' $1').replace(/^./, (c) => c.toUpperCase())} v={num(v)} />
                  ))}
              </div>
            </Card>
          </div>
        </div>
      )}

      {tab === 'health' && (
        <div className="space-y-4">
          <Grid cols={2}>
            {alerts.map((a) => (
              <Card key={a.label} className={a.tone === 'bad' ? 'border-bad/40' : undefined}>
                <p className="flex items-center gap-1.5 text-xs font-bold">
                  <span className={a.tone === 'ok' ? 'text-ok' : a.tone === 'bad' ? 'text-bad' : 'text-warn'}>
                    {a.tone === 'ok' ? <CheckCircle2 className="size-3.5" /> : <AlertTriangle className="size-3.5" />}
                  </span>
                  {a.label}
                </p>
                <p className="mt-1 font-display text-lg font-bold">{a.value}</p>
                <p className="mt-0.5 text-[11px] leading-relaxed text-ink-3">{a.detail}</p>
              </Card>
            ))}
          </Grid>

          <Card>
            <CardHeader title="Incidents" icon={<Radio className="size-4" />} subtitle="Operational, with the fallback behaviour stated" />
            <div className="space-y-2">
              {data.incidents.map((i) => (
                <div key={i.id} className="flex items-start gap-2.5 rounded-md border border-line p-2.5">
                  <Badge tone={i.severity === 'warn' ? 'warn' : i.severity === 'info' ? 'info' : 'bad'}>{i.severity}</Badge>
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2 text-xs font-semibold">
                      {i.title}
                      <span className="text-[10px] font-normal text-ink-3">{ago(i.at)}</span>
                      <StatusBadge status={i.status} />
                    </p>
                    <p className="mt-0.5 text-[11px] text-ink-2">{i.note}</p>
                  </div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {tab === 'ledger' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader
              title="Trial balance"
              icon={<Scale className="size-4" />}
              subtitle="Debits must equal credits. If they do not, the platform stops paying out."
              action={<Badge tone={ledger.balanced ? 'ok' : 'bad'}>{ledger.balanced ? 'Balanced' : 'Out of balance'}</Badge>}
            />
            <div className="grid grid-cols-3 gap-2">
              <div className="rounded-md border border-line p-2.5">
                <p className="text-[10px] text-ink-3">Entries</p>
                <p className="font-display text-lg font-bold">{num(ledger.entries)}</p>
              </div>
              <div className="rounded-md border border-line p-2.5">
                <p className="text-[10px] text-ink-3">Total debits</p>
                <p className="font-mono text-sm font-bold">{birr(ledger.trialBalance.debit)}</p>
              </div>
              <div className="rounded-md border border-line p-2.5">
                <p className="text-[10px] text-ink-3">Total credits</p>
                <p className="font-mono text-sm font-bold">{birr(ledger.trialBalance.credit)}</p>
              </div>
            </div>
            {ledger.lastEntry && (
              <div className="mt-3 border-t border-line pt-3">
                <p className="text-[11px] font-bold">Most recent posting</p>
                <p className="mt-1 font-mono text-[10px] text-ink-3">{ledger.lastEntry.id} · {ledger.lastEntry.journal} · {ago(ledger.lastEntry.at)}</p>
                <p className="mt-0.5 text-[11px] text-ink-2">{ledger.lastEntry.description}</p>
                {ledger.lastEntry.lines.map((l, i) => (
                  <p key={i} className="mt-0.5 flex justify-between text-[11px]">
                    <span>{l.account}</span>
                    <span className="font-mono">{birr(l.debit)} / {birr(l.credit)}</span>
                  </p>
                ))}
              </div>
            )}
          </Card>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Money position" />
              <KeyValue k="Commission 30d" v={birr(gmv.netRevenue30d)} />
              <KeyValue k="Escrow held" v={<b className="font-display text-sm">{birr(data.metrics.escrowBalance)}</b>} />
              <KeyValue k="Seller sales 30d" v={moneyShort(gmv.sellerSales30d)} />
              <p className="mt-2 text-[10px] leading-relaxed text-ink-3">Escrow is buyer money that has not yet reached the seller. It is a liability, not revenue.</p>
            </Card>
            <Notice tone="info" title="Full detail lives in Finance">
              The chart of accounts, manual adjustments and per-settlement blockers are on the Finance tab.
            </Notice>
          </div>
        </div>
      )}

      {tab === 'activity' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <Card>
            <CardHeader title="Recent activity" icon={<Activity className="size-4" />} />
            {data.activity.length === 0 ? (
              <Empty title="Nothing logged" message="Actions across the marketplace appear here." />
            ) : (
              <div className="space-y-1.5">
                {data.activity.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-x-2 gap-y-0.5 border-b border-line/60 pb-1.5 text-[11px] last:border-0">
                    <span className="font-semibold">{a.actor}</span>
                    <span className="font-mono text-ink-3">{a.action}</span>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{a.detail}</span>
                    <span className="text-ink-3">{ago(a.at)}</span>
                  </div>
                ))}
              </div>
            )}
          </Card>
          <Card>
            <CardHeader title="Operational" />
            <KeyValue k="Delivery success" v={`${health.deliverySuccess}%`} />
            <KeyValue k="Avg delivery days" v={String(data.metrics.avgDeliveryDays)} />
            <KeyValue k="Dispute rate" v={`${health.disputeRate}%`} />
            <KeyValue k="Sellers" v={num(data.metrics.activeSellers)} />
            <KeyValue k="Buyers" v={num(data.metrics.activeBuyers)} />
            <KeyValue
              k="Failed stops"
              v={<span className={breakdown.failedStops ? 'text-bad' : undefined}>{num(breakdown.failedStops ?? 0)}</span>}
            />
          </Card>
        </div>
      )}
    </div>
  );
}
