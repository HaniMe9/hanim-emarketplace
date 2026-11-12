import { Link } from 'react-router-dom';
import { Building2, FileText, Landmark, Package, Percent, TrendingDown, Wallet } from 'lucide-react';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { useQuery } from '../../lib/useQuery.ts';
import { birr, dateOnly, money, moneyShort, num } from '../../lib/format.ts';
import { Badge, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Notice, Progress, Spinner, Stat, StatusBadge } from '../../components/ui.tsx';
import type { Id, Invoice, Organization, Rfq } from '../../../shared/types.ts';

type Dashboard = {
  org: Organization;
  openRfqs: number;
  quotesReceived: number;
  negotiationPending: number;
  activePos: number;
  committedSpend: number;
  creditLimit: number;
  creditUsed: number;
  creditAvailable: number;
  savingsVsRetail: number;
  recent: Rfq[];
  dueInvoices: Invoice[];
  topSuppliers: { id: Id; name: string; spend: number; onTimePct: number; orders: number }[];
  vatAccrued: number;
  vatNote: string;
};

const CHART = { stroke: 'var(--color-line)', fontSize: 10, tickLine: false, axisLine: false } as const;

export function B2BDashboard() {
  const { data, loading, error, reload } = useQuery<Dashboard>('/b2b/dashboard');
  if (loading) return <Spinner label="Loading your B2B desk…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const creditPct = data.creditLimit ? (data.creditUsed / data.creditLimit) * 100 : 0;
  const supplierChart = data.topSuppliers.map((s) => ({ name: s.name.split(' ').slice(0, 2).join(' '), spend: s.spend }));

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">{data.org.name}</h1>
          <p className="mt-0.5 flex items-center gap-1.5 text-xs text-ink-3">
            <Building2 className="size-3.5" /> {data.org.city} · {data.org.tier === 'none' ? 'Prepaid only' : `${data.org.tier} terms`}
          </p>
        </div>
        <Link
          to="/b2b/rfqs"
          className="inline-flex h-9 items-center rounded-md bg-brand px-3.5 text-xs font-semibold text-on-brand transition hover:bg-brand-600"
        >
          New RFQ
        </Link>
      </div>

      <Grid cols={4}>
        <Stat label="Open RFQs" value={num(data.openRfqs)} sub={`${data.quotesReceived} quotes received`} icon={<FileText className="size-4" />} />
        <Stat label="In negotiation" value={num(data.negotiationPending)} sub="Counters you sent" tone={data.negotiationPending > 0 ? 'gold' : 'muted'} />
        <Stat label="Active POs" value={num(data.activePos)} sub={`${moneyShort(data.committedSpend)} committed`} tone="brand" icon={<Package className="size-4" />} />
        <Stat
          label="Saved vs retail"
          value={`${data.savingsVsRetail}%`}
          sub="Bulk pricing across POs"
          tone="ok"
          icon={<TrendingDown className="size-4" />}
        />
      </Grid>

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Recent RFQs"
              subtitle="Quote counts come from the actual quotations, not a counter anyone has to maintain"
              action={<Link to="/b2b/rfqs" className="text-[11px] font-semibold text-brand hover:underline">All RFQs</Link>}
            />
            {data.recent.length === 0 ? (
              <Empty title="No RFQs yet" message="Publish an RFQ to reach verified suppliers in one round." />
            ) : (
              <div className="space-y-1.5">
                {data.recent.map((r) => (
                  <Link
                    key={r.id}
                    to={`/b2b/rfqs?rfq=${r.id}`}
                    className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-2.5 transition hover:border-brand/40"
                  >
                    <div className="min-w-0">
                      <p className="flex items-center gap-2 text-xs font-semibold">
                        <span className="font-mono text-[11px] text-ink-3">{r.code}</span>
                        {r.title}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink-3">
                        {r.lines.length} line{r.lines.length === 1 ? '' : 's'} · {r.destination} · {r.incoterm.toUpperCase()} · closes {dateOnly(r.expiresAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge tone={r.status === 'open' ? 'brand' : r.status === 'awarded' ? 'ok' : 'muted'}>{r.status}</Badge>
                      <Badge tone="gold">{r.quotes} quote{r.quotes === 1 ? '' : 's'}</Badge>
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card>
            <CardHeader title="Spend by supplier" subtitle="Year to date, purchase orders only" />
            {supplierChart.length === 0 ? (
              <Empty title="No spend yet" message="Supplier concentration appears once POs are issued." />
            ) : (
              <div className="h-48">
                <ResponsiveContainer width="100%" height="100%">
                  <BarChart data={supplierChart} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                    <CartesianGrid {...CHART} horizontal={false} />
                    <XAxis type="number" {...CHART} tickFormatter={(v: number) => moneyShort(v)} />
                    <YAxis type="category" dataKey="name" {...CHART} width={96} />
                    <Tooltip formatter={(v) => money(Number(v))} cursor={{ fill: 'var(--color-surface-2)' }} />
                    <Bar dataKey="spend" name="Spend" fill="var(--color-brand)" radius={[0, 3, 3, 0]} barSize={14} />
                  </BarChart>
                </ResponsiveContainer>
              </div>
            )}
            <div className="mt-3 space-y-1.5 border-t border-line pt-3">
              {data.topSuppliers.map((s) => (
                <div key={s.id} className="flex items-center justify-between gap-2 text-[11px]">
                  <span className="font-semibold">{s.name}</span>
                  <span className="text-ink-3">{s.orders} POs · {s.onTimePct}% on time</span>
                  <span className="font-mono">{moneyShort(s.spend)}</span>
                </div>
              ))}
            </div>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Credit line" icon={<Landmark className="size-4" />} subtitle={data.creditLimit ? `${data.creditUsed ? Math.round(creditPct) : 0}% drawn` : 'No assessment on file'} />
            {data.creditLimit === 0 ? (
              <Notice tone="warn" title="Prepaid only">
                Complete a credit review to unlock net terms. Until then every purchase order must be prepaid.
              </Notice>
            ) : (
              <>
                <Progress value={creditPct} tone={creditPct > 85 ? 'bad' : creditPct > 60 ? 'warn' : 'ok'} />
                <div className="mt-3 space-y-0.5">
                  <KeyValue k="Limit" v={birr(data.creditLimit)} />
                  <KeyValue k="Drawn" v={birr(data.creditUsed)} />
                  <KeyValue k="Available" v={<b className="text-ok">{birr(data.creditAvailable)}</b>} />
                </div>
              </>
            )}
            <Link to="/b2b/credit" className="mt-3 block text-[11px] font-semibold text-brand hover:underline">
              See how the limit is calculated →
            </Link>
          </Card>

          <Card>
            <CardHeader title="Invoices due" icon={<Wallet className="size-4" />} />
            {data.dueInvoices.length === 0 ? (
              <Empty title="Nothing due" message="Your account is current." />
            ) : (
              <div className="space-y-1.5">
                {data.dueInvoices.map((i) => (
                  <Link key={i.id} to="/b2b/invoices" className="flex items-center justify-between gap-2 rounded border border-line p-2 text-[11px] transition hover:border-brand/40">
                    <div>
                      <p className="font-mono font-semibold">{i.code}</p>
                      <p className="text-ink-3">due {dateOnly(i.dueAt)}</p>
                    </div>
                    <div className="text-right">
                      <p className="font-mono font-semibold">{birr(i.amount)}</p>
                      <StatusBadge status={i.status} />
                    </div>
                  </Link>
                ))}
              </div>
            )}
          </Card>

          <Card className="bg-surface-2/60">
            <CardHeader title="VAT" icon={<Percent className="size-4" />} />
            <p className="font-display text-lg font-bold">{birr(data.vatAccrued)}</p>
            <p className="mt-1 text-[11px] leading-relaxed text-ink-3">{data.vatNote}</p>
          </Card>
        </div>
      </div>
    </div>
  );
}
