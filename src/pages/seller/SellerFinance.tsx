import { useState } from 'react';
import { Area, AreaChart, Bar, BarChart, CartesianGrid, Legend, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Banknote, Download, FileText, Landmark, Lock, Receipt, TrendingDown, TrendingUp, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, dateOnly, moneyShort, num } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Notice, Select, Spinner, Stat, StatusBadge, Tabs } from '../../components/ui.tsx';
import type { Id, JournalEntry, PayoutAccount, Settlement } from '../../../shared/types.ts';

type Tab = 'earnings' | 'payouts' | 'accounts' | 'ledger';

const CHART = { stroke: 'var(--color-line)', fontSize: 10, tickLine: false, axisLine: false } as const;

export function SellerFinance() {
  const [tab, setTab] = useState<Tab>('earnings');
  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Finance</h1>
        <p className="mt-0.5 text-xs text-ink-3">
          Every figure traces back to a journal entry. Escrow is held by HaniMarket, not by you.
        </p>
      </div>
      <Tabs
        tabs={[
          { id: 'earnings', label: 'Earnings' },
          { id: 'payouts', label: 'Settlements' },
          { id: 'accounts', label: 'Payout accounts' },
          { id: 'ledger', label: 'Journal' },
        ]}
        value={tab}
        onChange={(v) => setTab(v as Tab)}
      />
      {tab === 'earnings' && <Earnings />}
      {tab === 'payouts' && <Payouts />}
      {tab === 'accounts' && <Accounts />}
      {tab === 'ledger' && <Ledger />}
    </div>
  );
}

function Earnings() {
  const { data, loading, error, reload } = useQuery<{
    rows: { date: string; revenue: number; commission: number; net: number; orders: number }[];
    totals: { revenue: number; commission: number; net: number };
    byProduct: { title: string; revenue: number; commission: number }[];
    note: string;
  }>('/seller/earnings');

  if (loading) return <Spinner label="Loading earnings…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const chart = data.rows.slice(0, 14).reverse();
  const products = data.byProduct.slice(0, 6);

  return (
    <div className="space-y-4">
      <Grid cols={3}>
        <Stat label="Gross revenue" value={birr(data.totals.revenue)} sub={`${num(data.totals.revenue / 100)} ETB across ${data.rows.length} days`} tone="brand" icon={<TrendingUp className="size-4" />} />
        <Stat label="Commission" value={`−${birr(data.totals.commission)}`} sub="Charged per transaction" tone="warn" icon={<TrendingDown className="size-4" />} />
        <Stat label="Net to you" value={birr(data.totals.net)} sub={`${data.totals.revenue ? Math.round((data.totals.net / data.totals.revenue) * 100) : 0}% take-home`} tone="ok" icon={<Wallet className="size-4" />} />
      </Grid>

      <Card>
        <CardHeader title="Net earnings by day" subtitle="Gross sales less commission" />
        <div className="h-56">
          <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={chart} margin={{ top: 4, right: 4, left: -18, bottom: 0 }}>
              <defs>
                <linearGradient id="netFill" x1="0" y1="0" x2="0" y2="1">
                  <stop offset="0%" stopColor="var(--color-brand)" stopOpacity={0.35} />
                  <stop offset="100%" stopColor="var(--color-brand)" stopOpacity={0} />
                </linearGradient>
              </defs>
              <CartesianGrid {...CHART} vertical={false} />
              <XAxis dataKey="date" {...CHART} tickFormatter={(v: string) => dateOnly(v).slice(0, 6)} />
              <YAxis {...CHART} tickFormatter={(v: number) => moneyShort(v)} />
              <Tooltip content={<ChartTip />} />
              <Legend wrapperStyle={{ fontSize: 10 }} />
              <Area type="monotone" dataKey="revenue" name="Gross" stroke="var(--color-ink-3)" strokeWidth={1.5} fill="none" />
              <Area type="monotone" dataKey="net" name="Net" stroke="var(--color-brand)" strokeWidth={2} fill="url(#netFill)" />
            </AreaChart>
          </ResponsiveContainer>
        </div>
      </Card>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Top products" subtitle="By gross revenue" />
          {products.length === 0 ? (
            <Empty title="No sales yet" message="Revenue by product appears once you have fulfilled orders." />
          ) : (
            <div className="h-48">
              <ResponsiveContainer width="100%" height="100%">
                <BarChart data={products} layout="vertical" margin={{ top: 0, right: 8, left: 8, bottom: 0 }}>
                  <CartesianGrid {...CHART} horizontal={false} />
                  <XAxis type="number" {...CHART} tickFormatter={(v: number) => moneyShort(v)} />
                  <YAxis type="category" dataKey="title" {...CHART} width={110} tickFormatter={(v: string) => (v.length > 16 ? `${v.slice(0, 15)}…` : v)} />
                  <Tooltip content={<ChartTip />} />
                  <Bar dataKey="revenue" name="Gross" fill="var(--color-brand)" radius={[0, 3, 3, 0]} barSize={13} />
                </BarChart>
              </ResponsiveContainer>
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="How you are paid" subtitle="No lock-in, no listing fees" />
          <div className="space-y-2.5 text-xs leading-relaxed text-ink-2">
            <p>{data.note}</p>
            <div className="rounded-md border border-line bg-surface-2 p-3">
              <p className="mb-1.5 font-semibold text-ink">Settlement cycle</p>
              <ol className="list-decimal space-y-1 pl-4">
                <li>Sales accrue into an open settlement period.</li>
                <li>Refunds, returns and chargebacks are deducted from the period.</li>
                <li>When the period closes it becomes <b>ready</b> and you can request payout.</li>
                <li>Withholding tax is deducted at source. A receipt is issued for every period.</li>
              </ol>
            </div>
            <Notice tone="info">
              Cash-on-delivery orders only enter a settlement once the agent has deposited the cash and finance has
              confirmed the deposit. Unconfirmed cash never appears as your money.
            </Notice>
          </div>
        </Card>
      </div>
    </div>
  );
}

function Payouts() {
  const { data, loading, error, reload } = useQuery<{
    settlements: Settlement[];
    accounts: PayoutAccount[];
    statementTotals: { gross: number; commission: number; refunds: number; withholding: number; net: number };
    journal: JournalEntry[];
  }>('/seller/payouts');
  const [open, setOpen] = useState<Id | null>(null);
  const [busy, setBusy] = useState<Id | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const detail = useQuery<{ settlement: Settlement; orders: { code: string; at: string; gross: number; commission: number; net: number }[]; journal: JournalEntry[] }>(
    open ? `/seller/payouts/${open}` : null,
  );

  async function requestPayout(id: Id) {
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      await api.post(`/seller/payouts/${id}/request`, {});
      setMsg('Payout requested. Finance reviews it and the amount lands in your verified account.');
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not request that payout.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Loading settlements…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const t = data.statementTotals;

  return (
    <div className="space-y-4">
      <Grid cols={4}>
        <Stat label="Gross" value={moneyShort(t.gross)} />
        <Stat label="Commission" value={`−${moneyShort(t.commission)}`} tone="warn" />
        <Stat label="Refunds & chargebacks" value={`−${moneyShort(t.refunds)}`} tone="bad" />
        <Stat label="Withholding tax" value={`−${moneyShort(t.withholding)}`} tone="muted" />
      </Grid>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {data.settlements.length === 0 ? (
        <Empty icon={<Receipt className="size-5" />} title="No settlements yet" message="Your first settlement period opens as soon as you fulfil an order." />
      ) : (
        <div className="space-y-2">
          {data.settlements.map((s) => (
            <Card key={s.id} className={clsx('p-0', s.status === 'blocked' && 'border-bad/40')}>
              <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold">{s.code}</span>
                    <StatusBadge status={s.status} />
                    {s.holdFlag && <Badge tone="warn" icon={<Lock className="size-3" />}>Hold</Badge>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {dateOnly(s.periodFrom)} → {dateOnly(s.periodTo)} · {s.orderCount} orders
                  </p>
                  {s.blockedReason && <p className="mt-1 text-[11px] font-semibold text-bad">{s.blockedReason}</p>}
                  {s.payoutRef && <p className="mt-0.5 font-mono text-[10px] text-ink-3">Ref {s.payoutRef} · {s.paidAt && dateOnly(s.paidAt)}</p>}
                </div>

                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-display text-base font-bold">{birr(s.netPayable)}</p>
                    <p className="text-[10px] text-ink-3">of {birr(s.grossSales)} gross</p>
                  </div>
                  {s.status === 'ready' && (
                    <Button size="sm" variant="primary" loading={busy === s.id} onClick={() => void requestPayout(s.id)} icon={<Banknote className="size-3.5" />}>
                      Request payout
                    </Button>
                  )}
                  <Button size="sm" variant="ghost" onClick={() => setOpen(open === s.id ? null : s.id)}>
                    {open === s.id ? 'Hide' : 'Detail'}
                  </Button>
                </div>
              </div>

              {open === s.id && (
                <div className="border-t border-line bg-surface-2/60 p-3.5">
                  {detail.loading ? <Spinner label="Loading statement…" /> : detail.data ? (
                    <div className="grid gap-4 lg:grid-cols-2">
                      <div>
                        <p className="mb-1.5 text-xs font-bold">Statement</p>
                        <KeyValue k="Gross sales" v={birr(detail.data.settlement.grossSales)} />
                        <KeyValue k="Commission" v={`−${birr(detail.data.settlement.commission)}`} />
                        <KeyValue k="Refunds" v={`−${birr(detail.data.settlement.refunds)}`} />
                        <KeyValue k="Adjustments" v={birr(detail.data.settlement.adjustments)} />
                        <KeyValue k="Withholding tax" v={`−${birr(detail.data.settlement.withholdingTax)}`} />
                        <KeyValue k="Net payable" v={<b>{birr(detail.data.settlement.netPayable)}</b>} />
                        <p className="mt-2 text-[10px] text-ink-3">
                          Journal {detail.data.settlement.journalEntryId ?? 'not yet posted'} · posted by{' '}
                          {detail.data.journal[0]?.postedBy ?? '—'}
                        </p>
                      </div>
                      <div>
                        <p className="mb-1.5 text-xs font-bold">Orders in this period</p>
                        <div className="space-y-1">
                          {detail.data.orders.map((o) => (
                            <p key={o.code} className="flex items-center justify-between gap-2 rounded border border-line bg-surface px-2.5 py-1.5 text-[11px]">
                              <span className="font-mono">{o.code}</span>
                              <span className="text-ink-3">{dateOnly(o.at)}</span>
                              <span className="ml-auto font-semibold">{birr(o.net)}</span>
                            </p>
                          ))}
                        </div>
                        {detail.data.journal.length > 0 && (
                          <div className="mt-3">
                            <p className="mb-1.5 text-xs font-bold">Journal lines</p>
                            {detail.data.journal.map((j) => (
                              <div key={j.id} className="rounded border border-line bg-surface p-2.5">
                                <p className="font-mono text-[10px] text-ink-3">{j.id} · {j.journal} · {j.description}</p>
                                {j.lines.map((l, i) => (
                                  <p key={i} className="mt-0.5 flex justify-between text-[11px]">
                                    <span>{l.account}</span>
                                    <span className="font-mono">{birr(l.debit)} / {birr(l.credit)}</span>
                                  </p>
                                ))}
                              </div>
                            ))}
                          </div>
                        )}
                      </div>
                    </div>
                  ) : (
                    <p className="text-xs text-ink-3">Statement unavailable.</p>
                  )}
                </div>
              )}
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function Accounts() {
  const { data, loading, error, reload } = useQuery<{ accounts: PayoutAccount[] }>('/seller/payouts');
  const [bank, setBank] = useState('Commercial Bank of Ethiopia');
  const [name, setName] = useState('');
  const [number, setNumber] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  async function add(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      await api.post('/seller/payout-accounts', { bank, accountName: name.trim(), accountNumber: number.trim() });
      setMsg('Account added. It must be verified by finance before the first payout can be released to it.');
      setName('');
      setNumber('');
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not add that account.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading accounts…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
      <Card>
        <CardHeader title="Payout accounts" subtitle="Money only ever moves to a verified account in your organisation's name" />
        {msg && <Notice tone="ok" className="mb-3" onClose={() => setMsg(null)}>{msg}</Notice>}
        {err && <div className="mb-3"><ErrorNote message={err} /></div>}
        {(data?.accounts.length ?? 0) === 0 ? (
          <Empty icon={<Landmark className="size-5" />} title="No payout account" message="Add a bank account to receive settlements." />
        ) : (
          <div className="space-y-2">
            {data!.accounts.map((a) => (
              <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-line p-3">
                <div>
                  <p className="text-xs font-semibold">{a.bank}</p>
                  <p className="font-mono text-[11px] text-ink-3">{a.accountNumber}</p>
                  <p className="text-[11px] text-ink-3">{a.accountName}</p>
                </div>
                <div className="flex gap-1.5">
                  {a.isDefault && <Badge tone="brand">Default</Badge>}
                  <Badge tone={a.verified ? 'ok' : 'warn'}>{a.verified ? 'Verified' : 'Pending verification'}</Badge>
                </div>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card>
        <CardHeader title="Add an account" subtitle="Verified by finance, usually within one business day" />
        <form onSubmit={add} className="space-y-3">
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-2">Bank</span>
            <Select value={bank} onChange={(e) => setBank(e.target.value)}>
              <option>Commercial Bank of Ethiopia</option>
              <option>Bank of Abyssinia</option>
              <option>Dashen Bank</option>
              <option>Awash Bank</option>
              <option>Telebirr (wallet)</option>
              <option>Amhara Bank</option>
            </Select>
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-2">Account holder name</span>
            <input value={name} onChange={(e) => setName(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-surface px-3 text-xs" placeholder="As printed on the bank record" />
          </label>
          <label className="block">
            <span className="mb-1 block text-[11px] font-semibold text-ink-2">Account number</span>
            <input value={number} onChange={(e) => setNumber(e.target.value)} required className="h-9 w-full rounded-md border border-line bg-surface px-3 font-mono text-xs" placeholder="1000…" />
          </label>
          <Button type="submit" variant="primary" block loading={busy}>Add account</Button>
          <p className="text-[10px] leading-relaxed text-ink-3">
            HaniMarket never asks for a PIN, full card number, or a password over chat. Finance will never call you to
            "unlock" a payout.
          </p>
        </form>
      </Card>
    </div>
  );
}

function Ledger() {
  const { data, loading, error, reload } = useQuery<{ journal: JournalEntry[] }>('/seller/payouts');
  if (loading) return <Spinner label="Loading journal…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <Card>
      <CardHeader
        title="Journal"
        subtitle="Double-entry. Every posting balances or it does not post."
        action={<Button size="sm" variant="ghost" icon={<Download className="size-3.5" />}>Export</Button>}
      />
      {(data?.journal.length ?? 0) === 0 ? (
        <Empty icon={<FileText className="size-5" />} title="Nothing posted yet" message="Journal entries appear once a settlement posts." />
      ) : (
        <div className="space-y-2">
          {data!.journal.map((j) => {
            const dr = j.lines.reduce((a, l) => a + l.debit, 0);
            const cr = j.lines.reduce((a, l) => a + l.credit, 0);
            return (
              <details key={j.id} className="rounded-md border border-line">
                <summary className="flex cursor-pointer flex-wrap items-center gap-x-3 gap-y-1 p-3 text-xs">
                  <span className="font-mono text-[11px] font-bold">{j.id}</span>
                  <Badge tone={j.journal === 'settlement' ? 'ok' : 'muted'}>{j.journal}</Badge>
                  <span className="min-w-0 flex-1 truncate text-ink-2">{j.description}</span>
                  <span className="text-[10px] text-ink-3">{dateOnly(j.at)} · {j.postedBy}</span>
                  <span className={clsx('font-mono text-[11px] font-semibold', dr === cr ? 'text-ok' : 'text-bad')}>
                    {dr === cr ? 'balanced' : 'out of balance'}
                  </span>
                </summary>
                <div className="border-t border-line bg-surface-2/60 p-3">
                  <div className="mb-1 grid grid-cols-[1fr_76px_76px] gap-2 text-[10px] font-semibold tracking-wide text-ink-3 uppercase">
                    <span>Account</span>
                    <span className="text-right">Debit</span>
                    <span className="text-right">Credit</span>
                  </div>
                  {j.lines.map((l, i) => (
                    <p key={i} className="grid grid-cols-[1fr_76px_76px] gap-2 py-0.5 text-[11px]">
                      <span className="truncate">{l.account}{l.memo ? ` · ${l.memo}` : ''}</span>
                      <span className="text-right font-mono">{l.debit ? birr(l.debit) : ''}</span>
                      <span className="text-right font-mono">{l.credit ? birr(l.credit) : ''}</span>
                    </p>
                  ))}
                  <p className="mt-1.5 border-t border-line pt-1.5 text-right font-mono text-[11px] font-semibold">
                    Dr {birr(dr)} = Cr {birr(cr)}
                  </p>
                </div>
              </details>
            );
          })}
        </div>
      )}
    </Card>
  );
}

function ChartTip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border border-line bg-surface px-2.5 py-2 text-[11px] shadow-sm">
      <p className="mb-1 font-semibold">{dateOnly(label)}</p>
      {payload.map((p) => (
        <p key={p.name} className="flex items-center gap-1.5">
          <span className="size-1.5 rounded-full" style={{ background: p.color }} />
          {p.name}: <span className="font-mono">{birr(p.value)}</span>
        </p>
      ))}
    </div>
  );
}
