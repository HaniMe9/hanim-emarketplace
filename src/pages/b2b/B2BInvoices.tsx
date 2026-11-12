import { useState } from 'react';
import { AlertTriangle, Landmark, Printer, Receipt, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, dateOnly, num } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Notice, Select, Spinner, Stat, StatusBadge, Tabs } from '../../components/ui.tsx';
import type { CreditAssessment, Invoice, Minor } from '../../../shared/types.ts';

type InvoiceRow = Invoice & { daysOverdue: number };
type Totals = { outstanding: Minor; overdue: Minor; paid30d: Minor };

export function B2BInvoices() {
  const [tab, setTab] = useState('open');
  const { data, loading, error, reload } = useQuery<{ items: InvoiceRow[]; totals: Totals }>('/b2b/invoices');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [method, setMethod] = useState('bank_transfer');
  const { data: credit } = useQuery<{ credit: CreditAssessment }>('/b2b/credit');

  const all = data?.items ?? [];
  const items = all.filter((i) => {
    if (tab === 'open') return i.status !== 'paid' && i.status !== 'void';
    if (tab === 'overdue') return i.status === 'overdue';
    if (tab === 'paid') return i.status === 'paid';
    return true;
  });

  async function pay(id: string) {
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message: string }>(`/b2b/invoices/${id}/pay`, { method });
      setMsg(r.message);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not settle that invoice.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Loading invoices…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Invoices</h1>
        <p className="mt-0.5 text-xs text-ink-3">
          Paying is blocked until the matching purchase order is confirmed received.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="Outstanding" value={birr(data.totals.outstanding)} sub={`${all.filter((i) => i.status !== 'paid' && i.status !== 'void').length} invoices`} tone="brand" icon={<Receipt className="size-4" />} />
        <Stat label="Overdue" value={birr(data.totals.overdue)} sub={all.some((i) => i.status === 'overdue') ? 'Past due date' : 'Nothing past due'} tone={data.totals.overdue > 0 ? 'bad' : 'ok'} />
        <Stat label="Settled" value={birr(data.totals.paid30d)} sub="Paid to date" tone="ok" icon={<Wallet className="size-4" />} />
      </div>

      <div className="flex flex-wrap items-center gap-3">
        <Tabs
          tabs={[
            { id: 'open', label: 'Open', count: all.filter((i) => i.status !== 'paid' && i.status !== 'void').length },
            { id: 'overdue', label: 'Overdue', count: all.filter((i) => i.status === 'overdue').length },
            { id: 'paid', label: 'Paid' },
            { id: 'all', label: 'All' },
          ]}
          value={tab}
          onChange={setTab}
        />
        {credit && (
          <p className="ml-auto text-[11px] text-ink-3">
            Credit available <b className="font-mono text-ink-2">{birr(credit.credit.available)}</b> of {birr(credit.credit.limit)}
          </p>
        )}
      </div>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {items.length === 0 ? (
        <Empty icon={<Receipt className="size-5" />} title="No invoices in this view" message="Invoices are raised by suppliers against delivered purchase orders." />
      ) : (
        <div className="space-y-2">
          {items.map((i) => (
            <Card key={i.id} className={clsx('p-0', i.status === 'overdue' && 'border-bad/40')}>
              <div className="flex flex-wrap items-start justify-between gap-3 p-3.5">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs font-bold">{i.code}</span>
                    <StatusBadge status={i.status} />
                    {i.status === 'overdue' && (
                      <Badge tone="bad" icon={<AlertTriangle className="size-3" />}>{i.daysOverdue}d overdue</Badge>
                    )}
                    {i.paidAt && <Badge tone="ok">paid {dateOnly(i.paidAt)}</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">{i.sellerName}</p>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    against {i.poCode} · issued {dateOnly(i.issuedAt)} · due {dateOnly(i.dueAt)} · {i.term}
                  </p>
                  {i.fiscalReceiptNo && <p className="mt-0.5 font-mono text-[10px] text-ink-3">Fiscal receipt {i.fiscalReceiptNo}</p>}
                </div>

                <div className="flex flex-wrap items-center gap-2">
                  <div className="text-right">
                    <p className="font-display text-base font-bold">{birr(i.amount)}</p>
                    <p className="text-[10px] text-ink-3">VAT {birr(i.tax)} recoverable</p>
                  </div>
                  {i.status !== 'paid' && i.status !== 'void' && (
                    <>
                      <Select value={method} onChange={(e) => setMethod(e.target.value)} className="h-8 w-36 text-[11px]">
                        <option value="bank_transfer">Bank transfer</option>
                        <option value="telebirr">Telebirr</option>
                        <option value="credit_net30">Net 30 credit</option>
                        <option value="credit_net60">Net 60 credit</option>
                      </Select>
                      <Button size="sm" variant="primary" loading={busy === i.id} onClick={() => void pay(i.id)} icon={<Landmark className="size-3.5" />}>
                        Pay {birr(i.amount)}
                      </Button>
                    </>
                  )}
                  <Button size="sm" variant="ghost" icon={<Printer className="size-3.5" />}>PDF</Button>
                </div>
              </div>

              {i.status !== 'paid' && i.status !== 'void' && (
                <div className="border-t border-line bg-surface-2/50 px-3.5 py-2">
                  <p className="text-[10px] leading-relaxed text-ink-3">
                    Settling this releases the matching amount of credit headroom immediately. If the goods on{' '}
                    {i.poCode} have not been confirmed received, payment is refused — you cannot fund an order that
                    has not arrived.
                  </p>
                </div>
              )}
            </Card>
          ))}
        </div>
      )}

      <Card>
        <CardHeader title="Why VAT is never a cost here" />
        <p className="text-[11px] leading-relaxed text-ink-2">
          Every B2B invoice itemises VAT separately from goods and delivery. It appears on{' '}
          {num(all.length)} invoice{all.length === 1 ? '' : 's'} totalling{' '}
          {birr(all.reduce((a, i) => a + i.tax, 0))} of input tax, which is claimed back rather than absorbed into
          your cost base.
        </p>
      </Card>
    </div>
  );
}
