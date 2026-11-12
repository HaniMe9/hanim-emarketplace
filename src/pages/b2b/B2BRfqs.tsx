import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeftRight, CheckCircle2, FileQuestion, Plus, Send, Trash2, Trophy, X } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, birr, dateOnly, until } from '../../lib/format.ts';
import { Badge, Button, Card, Empty, ErrorNote, Field, Input, KeyValue, Notice, Select, Spinner, StatusBadge, Tabs, Textarea } from '../../components/ui.tsx';
import type { Id, Minor, Organization, Quotation, Rfq } from '../../../shared/types.ts';

type RfqRow = Rfq & { quoteCount: number; bestQuote: Quotation | null };
type QuoteRow = Quotation & { seller: Organization | null };
type Detail = {
  rfq: Rfq;
  quotes: QuoteRow[];
  bestQuote: Quotation | null;
  savings: Minor;
  awarded: Quotation | null;
  canAward: boolean;
  tradeOff: { cheapest: { sellerName: string; total: Minor; leadTimeDays: number } | null; fastest: { sellerName: string; total: Minor; leadTimeDays: number } | null } | null;
};

const FILTERS = [
  { id: '', label: 'All' },
  { id: 'open', label: 'Open' },
  { id: 'negotiating', label: 'Negotiating' },
  { id: 'awarded', label: 'Awarded' },
  { id: 'closed', label: 'Closed' },
];

export function B2BRfqs() {
  const [params, setParams] = useSearchParams();
  const openId = params.get('rfq');
  const [tab, setTab] = useState('');
  const [creating, setCreating] = useState(false);
  const { data, loading, error, reload } = useQuery<{ items: RfqRow[]; counts: Record<string, number> }>(
    `/b2b/rfqs${tab ? `?status=${tab}` : ''}`,
  );

  if (openId) return <RfqDetail id={openId} onBack={() => setParams({})} />;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Requests for quotation</h1>
          <p className="mt-0.5 text-xs text-ink-3">One request, many comparable quotes, a recorded award decision.</p>
        </div>
        <Button variant="primary" onClick={() => setCreating((v) => !v)} icon={<Plus className="size-4" />}>New RFQ</Button>
      </div>

      <Tabs tabs={FILTERS.map((f) => ({ id: f.id, label: f.label, count: f.id ? data?.counts[f.id] : undefined }))} value={tab} onChange={setTab} />

      {creating && (
        <NewRfq
          onClose={() => setCreating(false)}
          onDone={(code) => {
            setCreating(false);
            reload();
            return code;
          }}
        />
      )}

      {loading ? (
        <Spinner label="Loading RFQs…" />
      ) : error ? (
        <ErrorNote message={error} onRetry={reload} />
      ) : (data?.items.length ?? 0) === 0 ? (
        <Empty icon={<FileQuestion className="size-5" />} title="No RFQs here" message="Publish one and verified suppliers can quote against it." />
      ) : (
        <div className="space-y-2">
          {data!.items.map((r) => (
            <Card key={r.id} className="p-0">
              <button
                onClick={() => setParams({ rfq: r.id })}
                className="flex w-full flex-wrap items-center justify-between gap-3 p-3.5 text-left"
              >
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] text-ink-3">{r.code}</span>
                    <span className="text-sm font-semibold">{r.title}</span>
                    <StatusBadge status={r.status} />
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-3">
                    {r.lines.length} line{r.lines.length === 1 ? '' : 's'} · {r.destination} · {r.incoterm.toUpperCase()} ·{' '}
                    {r.terms === 'prepaid' ? 'Prepaid' : r.terms.replace('credit_', '').toUpperCase()} · expires {until(r.expiresAt)}
                  </p>
                </div>
                <div className="flex items-center gap-3">
                  <div className="text-right">
                    <p className="font-mono text-xs font-bold">{r.quoteCount} quote{r.quoteCount === 1 ? '' : 's'}</p>
                    {r.bestQuote && <p className="text-[10px] text-ink-3">best {moneyShortSafe(r.bestQuote.total)}</p>}
                  </div>
                  <Badge tone="brand">Open →</Badge>
                </div>
              </button>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}

function moneyShortSafe(minor: Minor) {
  return birr(minor);
}

function RfqDetail({ id, onBack }: { id: Id; onBack: () => void }) {
  const { data, loading, error, reload } = useQuery<Detail>(`/b2b/rfqs/${id}`);
  const [busy, setBusy] = useState<Id | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [counterFor, setCounterFor] = useState<QuoteRow | null>(null);

  async function accept(quote: QuoteRow) {
    setBusy(quote.id);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message: string; purchaseOrder: { code: string } }>(`/b2b/quotations/${quote.id}/accept`, {});
      setMsg(`${r.message} (${r.purchaseOrder.code})`);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not award that quotation.');
    } finally {
      setBusy(null);
    }
  }

  if (loading) return <Spinner label="Loading RFQ…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { rfq, quotes, bestQuote, savings, awarded, canAward, tradeOff } = data;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeftRight className="size-3.5 rotate-180" />}>All RFQs</Button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-[11px] text-ink-3">{rfq.code}</span>
              <h1 className="font-display text-lg font-bold">{rfq.title}</h1>
              <StatusBadge status={rfq.status} />
            </p>
            <p className="mt-1 text-[11px] text-ink-3">
              Published {dateOnly(rfq.createdAt)} · to {rfq.invitedSellerIds === 'all' ? 'the whole verified supplier network' : `${rfq.invitedSellerIds.length} invited suppliers`} · closes {until(rfq.expiresAt)}
            </p>
          </div>
          {rfq.terms !== 'prepaid' && <Badge tone="violet">{rfq.terms.replace('credit_', '').toUpperCase()} credit</Badge>}
        </div>

        <div className="mt-3 grid gap-3 border-t border-line pt-3 sm:grid-cols-2">
          <div>
            <p className="mb-1 text-[11px] font-bold">Lines</p>
            {rfq.lines.map((l, i) => (
              <p key={i} className="flex flex-wrap items-baseline justify-between gap-2 py-0.5 text-[11px]">
                <span className="min-w-0 flex-1">{i + 1}. {l.description}</span>
                <span className="text-ink-3">{l.targetQty} {l.unit ?? 'units'}</span>
                {l.targetPrice ? <span className="font-mono text-ink-2">target {birr(l.targetPrice)}</span> : <span className="text-ink-3">open price</span>}
              </p>
            ))}
          </div>
          <div>
            <p className="mb-1 text-[11px] font-bold">Terms</p>
            <KeyValue k="Destination" v={rfq.destination} />
            <KeyValue k="Incoterm" v={rfq.incoterm.toUpperCase()} />
            <KeyValue k="Window" v={`${dateOnly(rfq.deliveryWindow.from)} → ${dateOnly(rfq.deliveryWindow.to)}`} />
            <KeyValue k="Payment" v={rfq.terms === 'prepaid' ? 'Prepaid' : rfq.terms.replace('credit_', '').toUpperCase()} />
            {rfq.notes && <p className="mt-1.5 rounded border border-line bg-surface-2 p-2 text-[11px] text-ink-2">{rfq.notes}</p>}
          </div>
        </div>
      </Card>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {awarded && (
        <Notice tone="ok" title={`Awarded to ${awarded.sellerName}`}>
          {birr(awarded.total)} on {awarded.leadTimeDays}-day lead time. Every other quote on this RFQ was closed
          automatically, and the purchase order references this quote.
        </Notice>
      )}

      {tradeOff && !awarded && (
        <Notice tone="info" title="The cheapest quote is not automatically the right one">
          <p className="space-y-0.5">
            <span className="block">
              Cheapest — <b>{tradeOff.cheapest?.sellerName}</b> at {birr(tradeOff.cheapest?.total ?? 0)},{' '}
              {tradeOff.cheapest?.leadTimeDays} days
            </span>
            <span className="block">
              Fastest — <b>{tradeOff.fastest?.sellerName}</b> at {birr(tradeOff.fastest?.total ?? 0)},{' '}
              {tradeOff.fastest?.leadTimeDays} days
            </span>
            {savings > 0 && <span className="block">Spread across quotes: {birr(savings)}</span>}
          </p>
        </Notice>
      )}

      <div>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <Trophy className="size-4 text-gold" /> {quotes.length} quotation{quotes.length === 1 ? '' : 's'}
          {bestQuote && <span className="text-[11px] font-normal text-ink-3">· best {birr(bestQuote.total)} from {bestQuote.sellerName}</span>}
        </p>

        {quotes.length === 0 ? (
          <Empty title="No quotes yet" message={`Suppliers have until ${dateOnly(rfq.expiresAt)} to respond.`} />
        ) : (
          <div className="space-y-2">
            {quotes.map((q) => {
              const isBest = bestQuote?.id === q.id;
              const isAwarded = awarded?.id === q.id;
              return (
                <Card key={q.id} className={clsx(isAwarded && 'border-ok/40', !isAwarded && q.status === 'rejected' && 'opacity-60')}>
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="min-w-0 flex-1">
                      <p className="flex flex-wrap items-center gap-2">
                        <span className="text-sm font-semibold">{q.sellerName}</span>
                        {q.seller?.tier && q.seller.tier !== 'none' && <Badge tone="brand">{q.seller.tier}</Badge>}
                        {isAwarded ? (
                          <Badge tone="ok" icon={<CheckCircle2 className="size-3" />}>Awarded</Badge>
                        ) : isBest ? (
                          <Badge tone="gold" icon={<Trophy className="size-3" />}>Lowest price</Badge>
                        ) : null}
                        <StatusBadge status={q.status} />
                        {q.revisions.length > 1 && <Badge tone="muted">rev {q.revisions[q.revisions.length - 1].revision}</Badge>}
                      </p>
                      <p className="mt-0.5 text-[11px] text-ink-3">
                        {q.code} · {q.leadTimeDays}d lead · valid until {dateOnly(q.validUntil)} · {q.paymentTerms} · {q.incoterm.toUpperCase()}
                      </p>
                      <p className="mt-1 text-[11px] text-ink-2">
                        {q.lines.length} line{q.lines.length === 1 ? '' : 's'} · subtotal {birr(q.subtotal)} + delivery{' '}
                        {birr(q.deliveryFee)} + VAT {birr(q.tax)}
                      </p>
                    </div>
                    <div className="text-right">
                      <p className="font-display text-lg font-bold">{birr(q.total)}</p>
                      <p className="text-[10px] text-ink-3">{q.seller ? `${q.seller.rating}★ · ${q.seller.deliverySuccessRate}% on time` : ''}</p>
                    </div>
                  </div>

                  {q.counterHistory.length > 0 && (
                    <details className="mt-2 border-t border-line pt-2">
                      <summary className="cursor-pointer text-[11px] font-semibold text-ink-2">
                        Negotiation history ({q.counterHistory.length} message{q.counterHistory.length === 1 ? '' : 's'})
                      </summary>
                      <div className="mt-1.5 space-y-1">
                        {q.counterHistory.map((c, i) => (
                          <p key={i} className="text-[11px] text-ink-2">
                            <span className="font-semibold">{c.by === 'buyer' ? 'You' : q.sellerName}</span>{' '}
                            <span className="text-ink-3">· {ago(c.at)}</span>
                            {c.proposedTotal ? <span className="font-mono"> → {birr(c.proposedTotal)}</span> : null}
                            <br />
                            <span className="text-ink-3">{c.message}</span>
                          </p>
                        ))}
                      </div>
                    </details>
                  )}

                  {canAward && q.status !== 'rejected' && q.status !== 'accepted' && (
                    <div className="mt-2.5 flex flex-wrap gap-2 border-t border-line pt-2.5">
                      <Button size="sm" variant="primary" loading={busy === q.id} onClick={() => void accept(q)} icon={<CheckCircle2 className="size-3.5" />}>
                        Award this quote
                      </Button>
                      <Button size="sm" variant="secondary" onClick={() => setCounterFor(counterFor?.id === q.id ? null : q)} icon={<ArrowLeftRight className="size-3.5" />}>
                        Counter
                      </Button>
                    </div>
                  )}

                  {counterFor?.id === q.id && (
                    <CounterForm
                      quote={q}
                      onClose={() => setCounterFor(null)}
                      onDone={(m) => {
                        setCounterFor(null);
                        setMsg(m);
                        reload();
                      }}
                    />
                  )}
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function CounterForm({ quote, onClose, onDone }: { quote: QuoteRow; onClose: () => void; onDone: (msg: string) => void }) {
  const [total, setTotal] = useState(String(quote.total / 100));
  const [message, setMessage] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ message: string }>(`/b2b/quotations/${quote.id}/counter`, {
        proposedTotal: Math.round(Number(total) * 100),
        message: message.trim() || undefined,
      });
      onDone(r.message);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not send that counter.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="mt-2.5 grid gap-2 rounded-md border border-line bg-surface-2 p-3 sm:grid-cols-[140px_1fr]">
      <Field label="Counter total (ETB)" required>
        <Input type="number" step="0.01" min="0" value={total} onChange={(e) => setTotal(e.target.value)} required />
      </Field>
      <Field label="Message to seller" hint="Terms you want changed, not just a number">
        <Textarea rows={2} value={message} onChange={(e) => setMessage(e.target.value)} placeholder="e.g. We can take 500 units if you hold the price and ship in two lots." />
      </Field>
      {err && <div className="sm:col-span-2"><ErrorNote message={err} /></div>}
      <div className="flex gap-2 sm:col-span-2">
        <Button size="sm" type="submit" variant="primary" loading={busy} icon={<Send className="size-3.5" />}>Send counter</Button>
        <Button size="sm" type="button" variant="ghost" onClick={onClose} icon={<X className="size-3.5" />} />
      </div>
    </form>
  );
}

function NewRfq({ onClose, onDone }: { onClose: () => void; onDone: (code: string) => void }) {
  const [title, setTitle] = useState('');
  const [categoryId, setCategoryId] = useState('cat_bulk');
  const [terms, setTerms] = useState<'prepaid' | 'credit_net30' | 'credit_net60'>('prepaid');
  const [incoterm, setIncoterm] = useState<'exw' | 'fca' | 'cif' | 'd2d'>('d2d');
  const [destination, setDestination] = useState('Addis Ababa');
  const [notes, setNotes] = useState('');
  const [lines, setLines] = useState([{ description: '', targetQty: '100', unit: 'units', targetPrice: '' }]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ rfq: Rfq; message: string }>('/b2b/rfqs', {
        title: title.trim(),
        categoryId,
        terms,
        incoterm,
        destination: destination.trim(),
        notes: notes.trim() || undefined,
        lines: lines
          .filter((l) => l.description.trim())
          .map((l) => ({
            description: l.description.trim(),
            targetQty: Number(l.targetQty),
            unit: l.unit || undefined,
            targetPrice: l.targetPrice ? Math.round(Number(l.targetPrice) * 100) : undefined,
          })),
      });
      onDone(r.rfq.code);
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not publish that RFQ.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Card className="animate-rise border-brand/30">
      <p className="mb-3 flex items-center gap-1.5 text-sm font-bold"><FileQuestion className="size-4 text-brand" /> New RFQ</p>
      {err && <div className="mb-3"><ErrorNote message={err} /></div>}
      <form onSubmit={submit} className="space-y-3">
        <div className="grid gap-3 sm:grid-cols-2">
          <Field className="sm:col-span-2" label="Title" required>
            <Input value={title} onChange={(e) => setTitle(e.target.value)} required minLength={4} placeholder="Q3 2026 office coffee restock" />
          </Field>
          <Field label="Category">
            <Select value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
              <option value="cat_bulk">Bulk / general</option>
              <option value="cat_coffee">Coffee & Tea</option>
              <option value="cat_electronics">Electronics</option>
              <option value="cat_home">Home & Kitchen</option>
              <option value="cat_fashion">Fashion</option>
              <option value="cat_beauty">Beauty</option>
            </Select>
          </Field>
          <Field label="Destination">
            <Input value={destination} onChange={(e) => setDestination(e.target.value)} required />
          </Field>
          <Field label="Incoterm">
            <Select value={incoterm} onChange={(e) => setIncoterm(e.target.value as typeof incoterm)}>
              <option value="d2d">D2D — delivered to your door</option>
              <option value="cif">CIF — cost, insurance, freight</option>
              <option value="fca">FCA — free carrier</option>
              <option value="exw">EXW — ex works</option>
            </Select>
          </Field>
          <Field label="Payment terms" hint="Credit terms require an assessed credit line">
            <Select value={terms} onChange={(e) => setTerms(e.target.value as typeof terms)}>
              <option value="prepaid">Prepaid</option>
              <option value="credit_net30">Net 30 credit</option>
              <option value="credit_net60">Net 60 credit</option>
            </Select>
          </Field>
        </div>

        <div>
          <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Lines</p>
          <div className="space-y-2">
            {lines.map((l, i) => (
              <div key={i} className="grid gap-2 sm:grid-cols-[1fr_90px_90px_110px_32px]">
                <Input
                  value={l.description}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))}
                  placeholder="What you need"
                  required={i === 0}
                />
                <Input
                  type="number"
                  min="1"
                  value={l.targetQty}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, targetQty: e.target.value } : x)))}
                  placeholder="Qty"
                />
                <Input
                  value={l.unit}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))}
                  placeholder="Unit"
                />
                <Input
                  type="number"
                  step="0.01"
                  value={l.targetPrice}
                  onChange={(e) => setLines((ls) => ls.map((x, j) => (j === i ? { ...x, targetPrice: e.target.value } : x)))}
                  placeholder="Target ETB"
                />
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  className="text-bad"
                  onClick={() => setLines((ls) => (ls.length === 1 ? ls : ls.filter((_, j) => j !== i)))}
                  icon={<Trash2 className="size-3.5" />}
                />
              </div>
            ))}
          </div>
          <Button type="button" size="sm" variant="ghost" className="mt-2" onClick={() => setLines((ls) => [...ls, { description: '', targetQty: '100', unit: 'units', targetPrice: '' }])} icon={<Plus className="size-3.5" />}>
            Add line
          </Button>
        </div>

        <Field label="Notes for suppliers">
          <Textarea rows={2} value={notes} onChange={(e) => setNotes(e.target.value)} placeholder="Quality specs, packaging, split delivery, anything a supplier needs to quote accurately." />
        </Field>

        <div className="flex gap-2">
          <Button type="submit" variant="primary" loading={busy} icon={<Send className="size-4" />}>Publish RFQ</Button>
          <Button type="button" variant="ghost" onClick={onClose}>Cancel</Button>
        </div>
      </form>
    </Card>
  );
}
