import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { CheckCircle2, FileWarning, PackageCheck, PackageOpen, Scale, Truck } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, dateOnly, titleCase } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, KeyValue, Notice, Progress, Spinner, Stat, StatusBadge, Tabs } from '../../components/ui.tsx';
import type { CreditAssessment, Id, Invoice, Minor, PurchaseOrder, Quotation } from '../../../shared/types.ts';

type PoRow = PurchaseOrder & { invoice: Invoice | null };
type PoDetail = {
  po: PurchaseOrder;
  quotation: Quotation | null;
  invoice: Invoice | null;
  credit: CreditAssessment | null;
  canReceive: boolean;
  match: { ordered: Minor; invoiced: Minor; variance: Minor };
};

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'issued', label: 'Issued' },
  { id: 'confirmed', label: 'Confirmed' },
  { id: 'in_production', label: 'In production' },
  { id: 'partially_shipped', label: 'Partial' },
  { id: 'shipped', label: 'Shipped' },
  { id: 'delivered', label: 'Delivered' },
  { id: 'invoiced', label: 'Invoiced' },
  { id: 'settled', label: 'Settled' },
];

const STEPS = ['issued', 'confirmed', 'in_production', 'partially_shipped', 'shipped', 'delivered', 'invoiced', 'settled'];

export function B2BOrders() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('po');
  const [tab, setTab] = useState('');
  const { data, loading, error, reload } = useQuery<{ items: PoRow[]; counts: Record<string, number> }>(
    `/b2b/pos${tab ? `?status=${tab}` : ''}`,
  );

  if (openId) return <PoDetailView id={openId} onBack={() => setParams({})} />;

  const items = data?.items ?? [];
  const inFlight = items.filter((p) => !['settled', 'cancelled'].includes(p.status));

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Purchase orders</h1>
        <p className="mt-0.5 text-xs text-ink-3">Every PO references the quotation it came from, so the award is always traceable.</p>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <Stat label="In flight" value={String(inFlight.length)} tone="brand" icon={<Truck className="size-4" />} />
        <Stat label="Awaiting receipt" value={String(items.filter((p) => ['shipped', 'partially_shipped'].includes(p.status)).length)} tone="gold" icon={<PackageOpen className="size-4" />} />
        <Stat label="Committed" value={birr(inFlight.reduce((a, p) => a + p.total, 0))} sub="Not yet settled" />
      </div>

      <Tabs tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: f.id ? data?.counts[f.id] : undefined }))} value={tab} onChange={setTab} />

      {loading ? (
        <Spinner label="Loading purchase orders…" />
      ) : error ? (
        <ErrorNote message={error} onRetry={reload} />
      ) : items.length === 0 ? (
        <Empty icon={<PackageOpen className="size-5" />} title="No purchase orders" message="Award a quotation on an RFQ to create one." />
      ) : (
        <div className="space-y-2">
          {items.map((p) => {
            const stepIdx = STEPS.indexOf(p.status);
            return (
              <Card key={p.id} className="p-0">
                <button onClick={() => setParams({ po: p.id })} className="w-full p-3.5 text-left">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="font-mono text-xs font-bold">{p.code}</span>
                        <StatusBadge status={p.status} />
                        {p.terms !== 'prepaid' && <Badge tone="violet">{p.terms.replace('credit_', '').toUpperCase()}</Badge>}
                        {p.invoice && p.invoice.status === 'overdue' && <Badge tone="bad">Invoice overdue</Badge>}
                      </p>
                      <p className="mt-0.5 text-xs text-ink-2">
                        {p.sellerName} · {p.lines.length} line{p.lines.length === 1 ? '' : 's'} · expected {dateOnly(p.expectedAt)}
                      </p>
                      <p className="mt-0.5 text-[10px] text-ink-3">
                        from quote {p.quoteCode} · {p.incoterm.toUpperCase()} · {p.destination}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-base font-bold">{birr(p.total)}</p>
                      <p className="text-[10px] text-ink-3">VAT {birr(p.tax)} shown separately</p>
                    </div>
                  </div>
                  <div className="mt-2.5">
                    <div className="mb-1.5 flex items-center gap-1">
                      {STEPS.map((step, i) => (
                        <span
                          key={step}
                          className={clsx(
                            'h-1 flex-1 rounded-full',
                            i <= stepIdx ? (p.status === 'settled' ? 'bg-ok' : 'bg-brand') : 'bg-surface-3',
                          )}
                        />
                      ))}
                    </div>
                    <Progress value={p.progressPct} tone={p.status === 'settled' ? 'ok' : 'brand'} />
                    <p className="mt-1 flex justify-between text-[10px] text-ink-3">
                      <span>{STEPS[stepIdx] ?? titleCase(p.status)}</span>
                      <span>{p.progressPct}% · {titleCase(p.status)}</span>
                    </p>
                  </div>
                </button>
              </Card>
            );
          })}
        </div>
      )}
    </div>
  );
}

function PoDetailView({ id, onBack }: { id: Id; onBack: () => void }) {
  const { data, loading, error, reload } = useQuery<PoDetail>(`/b2b/pos/${id}`);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState('');

  async function receive() {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message: string; receivedLines: number; discrepancies: { description: string; qty: number }[] }>(
        `/b2b/pos/${id}/receive`,
        { note: note.trim() || undefined },
      );
      setMsg(
        r.discrepancies.length > 0
          ? `${r.message} Flagged ${r.discrepancies.length} line(s) as unavailable on arrival.`
          : r.message,
      );
      setNote('');
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not record that receipt.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading purchase order…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { po, quotation, invoice, credit, canReceive, match } = data;
  const varianceBad = match.variance !== 0;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} icon={<PackageOpen className="size-3.5" />}>All purchase orders</Button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm font-bold">{po.code}</span>
              <StatusBadge status={po.status} />
            </p>
            <p className="mt-1 text-xs text-ink-2">
              {po.sellerName} · issued {dateOnly(po.issuedAt)} · expected {dateOnly(po.expectedAt)}
            </p>
            <p className="mt-0.5 text-[10px] text-ink-3">Awarded from quotation {po.quoteCode}</p>
          </div>
          <div className="text-right">
            <p className="font-display text-xl font-bold">{birr(po.total)}</p>
            <p className="text-[10px] text-ink-3">{po.lines.length} lines · {po.incoterm.toUpperCase()}</p>
          </div>
        </div>
        <div className="mt-3 border-t border-line pt-3">
          <Progress value={po.progressPct} tone={po.status === 'settled' ? 'ok' : 'brand'} />
        </div>
      </Card>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Lines" subtitle="What was ordered" />
            <div className="overflow-x-auto">
              <table className="w-full min-w-[420px] text-left text-[11px]">
                <thead>
                  <tr className="text-ink-3">
                    <th className="pb-1.5 font-semibold">Description</th>
                    <th className="pb-1.5 text-right font-semibold">Qty</th>
                    <th className="pb-1.5 text-right font-semibold">Unit</th>
                    <th className="pb-1.5 text-right font-semibold">Line total</th>
                    <th className="pb-1.5 text-right font-semibold">Available</th>
                  </tr>
                </thead>
                <tbody>
                  {po.lines.map((l, i) => (
                    <tr key={i} className="border-t border-line/60">
                      <td className="py-1.5">{l.description}</td>
                      <td className="py-1.5 text-right font-mono">{l.qty}</td>
                      <td className="py-1.5 text-right font-mono">{birr(l.unitPrice)}</td>
                      <td className="py-1.5 text-right font-mono">{birr(l.qty * l.unitPrice)}</td>
                      <td className={clsx('py-1.5 text-right', !l.available && 'font-semibold text-bad')}>
                        {l.available ? 'Yes' : 'No'}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <div className="mt-3 space-y-0.5 border-t border-line pt-2.5">
              <KeyValue k="Subtotal" v={birr(po.subtotal)} />
              <KeyValue k="Delivery" v={birr(po.deliveryFee)} />
              <KeyValue k="VAT (recoverable)" v={birr(po.tax)} />
              <KeyValue k="Total" v={<b className="font-display text-sm">{birr(po.total)}</b>} />
            </div>
          </Card>

          <Card>
            <CardHeader title="Three-way match" icon={<Scale className="size-4" />} subtitle="Ordered vs invoiced vs what actually arrived" />
            <div className="grid gap-2 sm:grid-cols-3">
              <div className="rounded-md border border-line p-2.5">
                <p className="text-[10px] text-ink-3">Ordered</p>
                <p className="font-mono text-sm font-bold">{birr(match.ordered)}</p>
              </div>
              <div className="rounded-md border border-line p-2.5">
                <p className="text-[10px] text-ink-3">Invoiced</p>
                <p className="font-mono text-sm font-bold">{invoice ? birr(match.invoiced) : '—'}</p>
              </div>
              <div className={clsx('rounded-md border p-2.5', varianceBad ? 'border-bad/40 bg-bad/5' : 'border-ok/30')}>
                <p className="text-[10px] text-ink-3">Variance</p>
                <p className={clsx('font-mono text-sm font-bold', varianceBad ? 'text-bad' : 'text-ok')}>
                  {varianceBad ? birr(match.variance) : '0.00'}
                </p>
              </div>
            </div>
            {varianceBad ? (
              <Notice tone="bad" title="Invoice does not match the order" className="mt-3">
                Do not pay this invoice until the difference is resolved with {po.sellerName}. The variance is{' '}
                {birr(Math.abs(match.variance))} {match.variance > 0 ? 'over' : 'under'} the order value.
              </Notice>
            ) : (
              invoice && (
                <Notice tone="ok" className="mt-3" title={`Invoice ${invoice.code} matches the order`}>
                  Tax of {birr(invoice.tax)} is itemised separately and is recoverable.
                </Notice>
              )
            )}
          </Card>

          {quotation && (
            <Card>
              <CardHeader title="Awarded quotation" subtitle={`${quotation.code} · rev ${quotation.revisions[quotation.revisions.length - 1]?.revision ?? 1} · valid until ${dateOnly(quotation.validUntil)}`} />
              <KeyValue k="Lead time" v={`${quotation.leadTimeDays} days`} />
              <KeyValue k="Payment terms" v={quotation.paymentTerms} />
              <KeyValue k="Quoted total" v={birr(quotation.total)} />
            </Card>
          )}
        </div>

        <div className="space-y-4">
          {canReceive ? (
            <Card className="border-brand/30">
              <CardHeader title="Receive goods" icon={<PackageCheck className="size-4" />} />
              <p className="text-[11px] leading-relaxed text-ink-2">
                Confirm what physically arrived. Payment stays blocked until this happens, so you are never funding
                something that has not shipped.
              </p>
              <textarea
                rows={2}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Condition, packaging, delivery note number…"
                className="mt-2 w-full rounded-md border border-line bg-surface px-2.5 py-1.5 text-xs"
              />
              <Button variant="primary" block className="mt-2" loading={busy} onClick={() => void receive()} icon={<CheckCircle2 className="size-4" />}>
                Confirm receipt
              </Button>
            </Card>
          ) : (
            <Card>
              <CardHeader title="Receipt" icon={<Truck className="size-4" />} />
              <p className="text-[11px] leading-relaxed text-ink-3">
                {po.status === 'delivered' || po.status === 'invoiced' || po.status === 'settled'
                  ? 'Goods confirmed received. The invoice is now open for payment.'
                  : `Nothing can be received while the order is "${po.status.replace(/_/g, ' ')}".`}
              </p>
            </Card>
          )}

          {invoice && (
            <Card>
              <CardHeader title="Invoice" icon={<FileWarning className="size-4" />} />
              <KeyValue k="Code" v={<span className="font-mono">{invoice.code}</span>} />
              <KeyValue k="Amount" v={birr(invoice.amount)} />
              <KeyValue k="Term" v={invoice.term} />
              <KeyValue k="Due" v={dateOnly(invoice.dueAt)} />
              <div className="mt-2"><StatusBadge status={invoice.status} /></div>
            </Card>
          )}

          {credit && (
            <Card>
              <CardHeader title="Credit impact" />
              <KeyValue k="Limit" v={birr(credit.limit)} />
              <KeyValue k="Drawn" v={birr(credit.used)} />
              <KeyValue k="Available" v={<b className={credit.available > 0 ? 'text-ok' : 'text-bad'}>{birr(credit.available)}</b>} />
              <p className="mt-2 text-[10px] text-ink-3">Tier: {credit.tier.replace(/_/g, ' ')}. Credit is drawn when a PO is issued and released when its invoice settles.</p>
            </Card>
          )}
        </div>
      </div>
    </div>
  );
}
