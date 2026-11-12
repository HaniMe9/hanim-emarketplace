import { useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, FileText, Landmark, Lock, Scale, Sliders, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, dateOnly, moneyShort, num } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Field, Grid, Input, KeyValue, Notice, Select, Spinner, Stat, StatusBadge, Tabs, Textarea } from '../../components/ui.tsx';
import type { CodDeposit, Id, JournalEntry, Minor, PayoutAccount, PlatformSettings, ReconciliationRun, Settlement, TaxReceipt } from '../../../shared/types.ts';

type Finance = {
  ledger: { entries: JournalEntry[]; balanced: boolean; trialBalance: { debit: Minor; credit: Minor; accounts: { account: string; label: string; debit: Minor; credit: Minor }[] } };
  settlements: (Settlement & { blockedBy: string | null; organisation: string })[];
  reconciliations: ReconciliationRun[];
  codDeposits: CodDeposit[];
  taxReceipts: TaxReceipt[];
  payoutAccounts: PayoutAccount[];
  fees: PlatformSettings;
  revenue: { commission30d: Minor; delivery30d: Minor; pspExpense30d: Minor; escrowBalance: Minor };
};

type Account = { code: string; label: string };

export function AdminFinance() {
  const [tab, setTab] = useState('settlements');
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Finance</h1>
          <p className="mt-0.5 text-xs text-ink-3">Settlements, the chart of accounts and every payout blocker in one place.</p>
        </div>
        <Tabs
          tabs={[
            { id: 'settlements', label: 'Settlements' },
            { id: 'accounts', label: 'Chart of accounts' },
            { id: 'adjustments', label: 'Adjustments' },
            { id: 'tax', label: 'Tax receipts' },
          ]}
          value={tab}
          onChange={setTab}
        />
      </div>
      {tab === 'settlements' && <Settlements />}
      {tab === 'accounts' && <ChartOfAccounts />}
      {tab === 'adjustments' && <Adjustments />}
      {tab === 'tax' && <TaxReceipts />}
    </div>
  );
}

function Settlements() {
  const { data, loading, error, reload } = useQuery<Finance>('/admin/finance');
  const [busy, setBusy] = useState<Id | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <Spinner label="Loading finance…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const blocked = data.settlements.filter((s) => s.blockedBy);
  const ready = data.settlements.filter((s) => s.status === 'ready' && !s.blockedBy);

  async function act(id: Id, action: 'approve' | 'pay') {
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message: string }>(`/admin/settlements/${id}/${action}`, {});
      setMsg(r.message);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That payout step could not be completed.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <Grid cols={4}>
          <Stat label="Commission" value={moneyShort(data.revenue.commission30d)} tone="ok" />
          <Stat label="Delivery fees" value={moneyShort(data.revenue.delivery30d)} />
          <Stat label="PSP expense" value={moneyShort(data.revenue.pspExpense30d)} tone="warn" />
          <Stat label="Escrow liability" value={moneyShort(data.revenue.escrowBalance)} tone="gold" icon={<Wallet className="size-4" />} />
        </Grid>
        <Badge tone={data.ledger.balanced ? 'ok' : 'bad'} icon={data.ledger.balanced ? <CheckCircle2 className="size-3" /> : <AlertTriangle className="size-3" />}>
          {data.ledger.balanced ? 'Ledger balanced' : 'Ledger out of balance'}
        </Badge>
      </div>

      {(blocked.length > 0 || ready.length > 0) && (
        <Notice tone={blocked.length > 0 ? 'bad' : 'info'} title={blocked.length > 0 ? `${blocked.length} payout(s) blocked by reconciliation` : `${ready.length} settlement(s) ready`}>
          {blocked.length > 0
            ? 'A cash shortfall is not a reason to approve anyway. Resolve the remittance variance on the Reconciliation tab and these unlock themselves.'
            : 'Approving posts nothing to the ledger. Paying posts a balanced journal entry and releases credit headroom.'}
        </Notice>
      )}

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      <div className="space-y-2">
        {data.settlements.map((s) => (
          <Card key={s.id} className={clsx('p-0', s.blockedBy && 'border-bad/40')}>
            <div className="flex flex-wrap items-center justify-between gap-3 p-3.5">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="font-mono text-xs font-bold">{s.code}</span>
                  <StatusBadge status={s.status} />
                  {s.blockedBy && <Badge tone="bad" icon={<Lock className="size-3" />}>Blocked</Badge>}
                  {s.holdFlag && !s.blockedBy && <Badge tone="warn">Hold</Badge>}
                </p>
                <p className="mt-0.5 text-[11px] text-ink-2">{s.organisation}</p>
                <p className="mt-0.5 text-[10px] text-ink-3">
                  {dateOnly(s.periodFrom)} → {dateOnly(s.periodTo)} · {s.orderCount} orders
                  {s.payoutRef ? ` · ${s.payoutRef} via ${s.payoutMethod}` : ''}
                </p>
                {s.blockedBy && <p className="mt-1 text-[11px] font-semibold text-bad">{s.blockedBy}</p>}
              </div>

              <div className="flex items-center gap-2.5">
                <div className="text-right">
                  <p className="font-display text-base font-bold">{birr(s.netPayable)}</p>
                  <p className="text-[10px] text-ink-3">gross {birr(s.grossSales)}</p>
                </div>
                {!s.blockedBy && (s.status === 'ready' || s.status === 'accruing') && (
                  <Button size="sm" variant="secondary" loading={busy === s.id} onClick={() => void act(s.id, 'approve')}>
                    Approve
                  </Button>
                )}
                {!s.blockedBy && (s.status === 'approved' || s.status === 'ready') && (
                  <Button size="sm" variant="primary" loading={busy === s.id} onClick={() => void act(s.id, 'pay')} icon={<Banknote className="size-3.5" />}>
                    Pay out
                  </Button>
                )}
              </div>
            </div>
          </Card>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader title="Payout accounts" icon={<Landmark className="size-4" />} subtitle="Payouts only ever go to a verified account" />
          {data.payoutAccounts.length === 0 ? (
            <Empty title="None on file" message="No seller has a payout account yet." />
          ) : (
            <div className="space-y-1.5">
              {data.payoutAccounts.map((a) => (
                <div key={a.id} className="flex flex-wrap items-center justify-between gap-2 rounded border border-line p-2 text-[11px]">
                  <span className="font-semibold">{a.accountName}</span>
                  <span className="font-mono text-ink-3">{a.accountNumber}</span>
                  <span className="text-ink-3">{a.bank}</span>
                  <Badge tone={a.verified ? 'ok' : 'bad'}>{a.verified ? 'verified' : 'unverified'}</Badge>
                </div>
              ))}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader title="Fee configuration" icon={<Sliders className="size-4" />} subtitle="Change these on the Settings tab" />
          <KeyValue k="VAT rate" v={`${data.fees.vatRate}%`} />
          <KeyValue k="Withholding tax" v={`${data.fees.withholdingRate}%`} />
          <KeyValue k="Payout schedule" v={data.fees.payoutSchedule} />
          <KeyValue k="Settlement hold" v={`${data.fees.settlementHoldDays} days`} />
          <KeyValue k="Dispute SLA" v={`${data.fees.disputeSlaHours}h`} />
          <KeyValue k="Free delivery above" v={birr(data.fees.freeDeliveryThreshold)} />
        </Card>
      </div>
    </div>
  );
}

function ChartOfAccounts() {
  const { data: ledger, loading, error } = useQuery<{ trialBalance: Finance['ledger']['trialBalance']; accounts: Account[]; balanced: boolean }>('/admin/ledger');
  const { data, loading: l2 } = useQuery<Finance>('/admin/finance');
  const [journal, setJournal] = useState('');

  type LedgerRow = Omit<JournalEntry, 'lines'> & { lines: { account: string; label: string; debit: Minor; credit: Minor; memo?: string }[] };
  const { data: entries } = useQuery<{ items: LedgerRow[] }>(
    `/admin/ledger${journal ? `?journal=${journal}` : ''}`,
  );

  if (loading || l2) return <Spinner label="Loading ledger…" />;
  if (error) return <ErrorNote message={error} />;
  if (!ledger || !data) return null;

  const accounts = ledger.trialBalance.accounts ?? [];

  return (
    <div className="space-y-4">
      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <Card>
          <CardHeader
            title="Trial balance"
            icon={<Scale className="size-4" />}
            subtitle="Every posting balances. This is checked at boot and after every entry."
            action={<Badge tone={data.ledger.balanced ? 'ok' : 'bad'}>{data.ledger.balanced ? 'Balanced' : 'Broken'}</Badge>}
          />
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-left text-[11px]">
              <thead>
                <tr className="text-ink-3">
                  <th className="pb-1.5 font-semibold">Account</th>
                  <th className="pb-1.5 text-right font-semibold">Debit</th>
                  <th className="pb-1.5 text-right font-semibold">Credit</th>
                  <th className="pb-1.5 text-right font-semibold">Net</th>
                </tr>
              </thead>
              <tbody>
                {accounts.map((a) => {
                  const net = a.debit - a.credit;
                  return (
                    <tr key={a.account} className="border-t border-line/60">
                      <td className="py-1.5">
                        <span className="font-mono text-[10px] text-ink-3">{a.account}</span> {a.label}
                      </td>
                      <td className="py-1.5 text-right font-mono">{a.debit ? birr(a.debit) : ''}</td>
                      <td className="py-1.5 text-right font-mono">{a.credit ? birr(a.credit) : ''}</td>
                      <td className={clsx('py-1.5 text-right font-mono', net === 0 ? 'text-ok' : net > 0 ? 'text-brand' : 'text-gold')}>
                        {net === 0 ? '0.00' : birr(Math.abs(net))}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
              <tfoot>
                <tr className="border-t-2 border-line font-bold">
                  <td className="py-1.5">Total</td>
                  <td className="py-1.5 text-right font-mono">{birr(ledger.trialBalance.debit)}</td>
                  <td className="py-1.5 text-right font-mono">{birr(ledger.trialBalance.credit)}</td>
                  <td className={clsx('py-1.5 text-right font-mono', data.ledger.balanced ? 'text-ok' : 'text-bad')}>
                    {data.ledger.balanced ? 'balanced' : 'OUT OF BALANCE'}
                  </td>
                </tr>
              </tfoot>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Journal volume" />
          <div className="space-y-1">
            {['sales', 'settlement', 'refund', 'accrual', 'reconciliation', 'tax'].map((j) => (
              <button
                key={j}
                onClick={() => setJournal(journal === j ? '' : j)}
                className={clsx(
                  'flex w-full items-center justify-between rounded border px-2.5 py-1.5 text-[11px] transition',
                  journal === j ? 'border-brand bg-brand/5' : 'border-line hover:border-brand/40',
                )}
              >
                <span className="capitalize">{j}</span>
                <span className="text-ink-3">
                  {num(data.ledger.entries.filter((e) => e.journal === j).length)} shown
                </span>
              </button>
            ))}
          </div>
          {journal && <Button size="sm" variant="ghost" className="mt-2" onClick={() => setJournal('')}>Clear filter</Button>}
          <p className="mt-2 text-[10px] text-ink-3">Suspense holds manual adjustments until a real event clears them.</p>
        </Card>
      </div>

      <Card>
        <CardHeader title={`Journal entries${journal ? ` · ${journal}` : ''}`} subtitle="Newest first" />
        {(entries?.items.length ?? 0) === 0 ? (
          <Empty icon={<FileText className="size-5" />} title="Nothing posted" message="No entries in this journal." />
        ) : (
          <div className="space-y-1.5">
            {entries!.items.slice(0, 25).map((e) => {
              const dr = e.lines.reduce((a, l) => a + l.debit, 0);
              const cr = e.lines.reduce((a, l) => a + l.credit, 0);
              return (
                <details key={e.id} className="rounded-md border border-line">
                  <summary className="flex cursor-pointer flex-wrap items-center gap-x-2.5 gap-y-1 p-2.5 text-[11px]">
                    <span className="font-mono font-bold">{e.id}</span>
                    <Badge tone="muted">{e.journal}</Badge>
                    <span className="min-w-0 flex-1 truncate text-ink-2">{e.description}</span>
                    <span className="text-ink-3">{dateOnly(e.at)} · {e.postedBy}</span>
                    <span className={clsx('font-mono', dr === cr ? 'text-ok' : 'text-bad')}>{dr === cr ? 'ok' : 'unbalanced'}</span>
                  </summary>
                  <div className="border-t border-line bg-surface-2/60 p-2.5">
                    {e.lines.map((l, i) => (
                      <p key={i} className="grid grid-cols-[1fr_80px_80px] gap-2 py-0.5 text-[11px]">
                        <span className="truncate">{l.label ?? l.account}</span>
                        <span className="text-right font-mono">{l.debit ? birr(l.debit) : ''}</span>
                        <span className="text-right font-mono">{l.credit ? birr(l.credit) : ''}</span>
                      </p>
                    ))}
                  </div>
                </details>
              );
            })}
          </div>
        )}
      </Card>
    </div>
  );
}

function Adjustments() {
  const { data, loading: l1 } = useQuery<{ accounts: Account[] }>('/admin/ledger');
  const [account, setAccount] = useState('suspense');
  const [amount, setAmount] = useState('');
  const [memo, setMemo] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function post(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ journalEntry: JournalEntry; message: string }>('/admin/ledger/adjustment', {
        account,
        amount: Math.round(Number(amount) * 100),
        memo: memo.trim() || undefined,
      });
      setMsg(`${r.message} (${r.journalEntry.id})`);
      setAmount('');
      setMemo('');
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not post that adjustment.');
    } finally {
      setBusy(false);
    }
  }

  if (l1) return <Spinner label="Loading accounts…" />;

  return (
    <div className="grid gap-4 lg:grid-cols-[360px_1fr]">
      <Card>
        <CardHeader title="Manual adjustment" icon={<Sliders className="size-4" />} subtitle="Goes through suspense so it stays visible until a real event clears it" />
        {msg && <Notice tone="ok" className="mb-3" onClose={() => setMsg(null)}>{msg}</Notice>}
        {err && <div className="mb-3"><ErrorNote message={err} /></div>}
        <form onSubmit={post} className="space-y-3">
          <Field label="Account" required>
            <Select value={account} onChange={(e) => setAccount(e.target.value)}>
              {(data?.accounts ?? []).map((a) => (
                <option key={a.code} value={a.code}>{a.code} — {a.label}</option>
              ))}
            </Select>
          </Field>
          <Field label="Amount (ETB)" required>
            <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} required />
          </Field>
          <Field label="Business reason" required hint="Required. Goes to the audit log.">
            <Textarea rows={3} value={memo} onChange={(e) => setMemo(e.target.value)} required minLength={6} placeholder="e.g. Bank fee charged twice in March; recovered from PSP in April." />
          </Field>
          <Button type="submit" variant="primary" block loading={busy} icon={<Scale className="size-3.5" />}>Post balanced adjustment</Button>
        </form>
      </Card>

      <Card>
        <CardHeader title="Rules for manual entries" />
        <ul className="space-y-2 text-[11px] leading-relaxed text-ink-2">
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> An adjustment always posts two lines, so the trial balance is untouched.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Suspense is the only account a manual entry may move without a real event behind it.</li>
          <li className="flex gap-2"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Escrow and seller payable balances are never hand-edited. They move only on delivery, dispute and settlement events.</li>
          <li className="flex gap-2"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-warn" /> Every adjustment is audited with the actor, before and after state, and your reason.</li>
        </ul>
      </Card>
    </div>
  );
}

function TaxReceipts() {
  const { data, loading, error } = useQuery<Finance>('/admin/finance');
  if (loading) return <Spinner label="Loading tax receipts…" />;
  if (error) return <ErrorNote message={error} />;
  if (!data) return null;

  return (
    <Card>
      <CardHeader title="Fiscal receipts" icon={<FileText className="size-4" />} subtitle="One per order, with the fiscal code that the receipt maps to" />
      {data.taxReceipts.length === 0 ? (
        <Empty title="No receipts" message="Receipts are generated as orders are placed." />
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[560px] text-left text-[11px]">
            <thead>
              <tr className="text-ink-3">
                <th className="pb-1.5 font-semibold">Order</th>
                <th className="pb-1.5 font-semibold">Buyer</th>
                <th className="pb-1.5 text-right font-semibold">Gross</th>
                <th className="pb-1.5 text-right font-semibold">VAT</th>
                <th className="pb-1.5 text-right font-semibold">Net</th>
                <th className="pb-1.5 font-semibold">Receipt</th>
                <th className="pb-1.5 font-semibold">Status</th>
              </tr>
            </thead>
            <tbody>
              {data.taxReceipts.map((t) => (
                <tr key={t.id} className="border-t border-line/60">
                  <td className="py-1.5 font-mono">{t.orderCode}</td>
                  <td className="py-1.5">{t.buyerName}</td>
                  <td className="py-1.5 text-right font-mono">{birr(t.gross)}</td>
                  <td className="py-1.5 text-right font-mono">{birr(t.tax)}</td>
                  <td className="py-1.5 text-right font-mono">{birr(t.net)}</td>
                  <td className="py-1.5 font-mono text-[10px]">{t.fiscalReceiptNo}</td>
                  <td className="py-1.5"><StatusBadge status={t.status} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
