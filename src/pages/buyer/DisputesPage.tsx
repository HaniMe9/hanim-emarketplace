import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Clock, MessageSquare, Plus, ShieldAlert, ShieldCheck } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { useUser } from '../../lib/session.tsx';
import { birr, dateTime, until } from '../../lib/format.ts';
import {
  Badge, Button, Card, Empty, ErrorNote, Field, Notice, Select, Spinner, StatusBadge, Textarea,
} from '../../components/ui.tsx';
import type { Dispute, DisputeReason, Order } from '../../../shared/types.ts';

const REASONS: { id: DisputeReason; label: string; am: string }[] = [
  { id: 'not_received', label: 'Never arrived', am: 'አልደረሰም' },
  { id: 'damaged', label: 'Arrived damaged', am: 'ተጎዳች' },
  { id: 'wrong_item', label: 'Wrong item sent', am: 'የተሳሳተ ዕቃ' },
  { id: 'missing_parts', label: 'Parts missing', am: 'ከፍሎች የሉል' },
  { id: 'not_as_described', label: 'Not as described', am: 'እንደተገለጸው አይደለም' },
  { id: 'late_delivery', label: 'Very late delivery', am: 'በጣም ዘግይት' },
  { id: 'counterfeit', label: 'Suspected counterfeit', am: 'እድል በሆነ በሚባል' },
  { id: 'other', label: 'Something else', am: 'ሌላ' },
];

export function DisputesPage() {
  const user = useUser();
  const { data, loading, error, reload } = useQuery<{ items: Dispute[]; open: number }>('/disputes');
  const orders = useQuery<{ items: Order[] }>('/orders');
  const [showForm, setShowForm] = useState(false);
  const [orderCode, setOrderCode] = useState('');
  const [reason, setReason] = useState<DisputeReason>('not_received');
  const [summary, setSummary] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);

  const mine = (data?.items ?? []).filter((d) => user.role === 'admin' || d.buyerId === user.id);
  const deliverable = (orders.data?.items ?? []).filter((o) => o.status === 'delivered');

  async function create(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const res = await api.post<{ dispute: Dispute; message: string }>('/disputes', {
        orderCode: orderCode.trim().toUpperCase(),
        reason,
        summary: summary.trim(),
      });
      setMsg(`${res.dispute.code} opened. ${res.message}`);
      setShowForm(false);
      setOrderCode('');
      setSummary('');
      reload();
      orders.reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not open the dispute.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading disputes…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Dispute centre</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {data?.open ?? 0} case{(data?.open ?? 0) === 1 ? '' : 's'} open platform-wide. Funds stay in escrow until
            a case is decided.
          </p>
        </div>
        <Button variant="primary" onClick={() => setShowForm((v) => !v)} icon={<Plus className="size-4" />}>
          Open a dispute
        </Button>
      </div>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {showForm && (
        <Card className="animate-rise border-brand/30">
          <p className="mb-3 flex items-center gap-1.5 text-sm font-bold">
            <ShieldAlert className="size-4 text-bad" /> Open a dispute
          </p>
          <form onSubmit={create} className="grid gap-3 sm:grid-cols-2">
            <Field label="Which order?" required>
              <Select value={orderCode} onChange={(e) => setOrderCode(e.target.value)} required>
                <option value="">Choose an order…</option>
                {deliverable.map((o) => (
                  <option key={o.code} value={o.code}>
                    {o.code} · {o.lines[0]?.title.slice(0, 34)} · {birr(o.total, { decimals: false })}
                  </option>
                ))}
                {deliverable.length === 0 && <option value="">No delivered orders to dispute</option>}
              </Select>
            </Field>
            <Field label="What went wrong?" required>
              <Select value={reason} onChange={(e) => setReason(e.target.value as DisputeReason)}>
                {REASONS.map((r) => (
                  <option key={r.id} value={r.id}>{r.label} · {r.am}</option>
                ))}
              </Select>
            </Field>
            <Field className="sm:col-span-2" label="Describe what happened" required
              hint="Be specific: what you ordered, what arrived, and what you have already tried.">
              <Textarea
                rows={4}
                value={summary}
                onChange={(e) => setSummary(e.target.value)}
                required
                minLength={10}
                placeholder="The box was open on arrival and two of the six bulbs were broken. I have photos of the packaging."
              />
            </Field>
            <div className="sm:col-span-2 flex flex-wrap gap-2">
              <Button type="submit" variant="primary" loading={busy} disabled={!orderCode || summary.trim().length < 10}>
                Open case
              </Button>
              <Button type="button" variant="ghost" onClick={() => setShowForm(false)}>Cancel</Button>
            </div>
          </form>
          <Notice tone="info" className="mt-3">
            You have 7 days after delivery to open a case. Once open, the seller's payout for that order is blocked
            until it is decided — that is the point of escrow, and it works in both directions.
          </Notice>
        </Card>
      )}

      {mine.length === 0 ? (
        <Empty
          icon={<ShieldCheck className="size-5" />}
          title="No disputes on your orders"
          message="That is a good sign. If something arrives wrong, open a case and the money stays put until it is sorted."
        />
      ) : (
        <div className="space-y-3">
          {mine.map((d) => {
            const hoursLeft = Math.round((+new Date(d.dueAt) - Date.now()) / 3600000);
            const closed = ['closed', 'resolved_buyer', 'resolved_seller'].includes(d.status);
            const open = expanded === d.id;
            return (
              <Card key={d.id} className={clsx(!closed && hoursLeft < 0 && 'border-bad/30')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-sm font-bold">{d.code}</span>
                      <StatusBadge status={d.status} />
                      <Badge tone="muted">{REASONS.find((r) => r.id === d.reason)?.label ?? d.reason}</Badge>
                    </p>
                    <p className="mt-1 text-sm font-semibold">{d.summary}</p>
                    <p className="mt-0.5 text-[11px] text-ink-3">
                      Order{' '}
                      <Link to={`/orders/${d.orderCode}`} className="font-mono text-brand hover:underline">
                        {d.orderCode}
                      </Link>{' '}
                      · {d.sellerName} · opened {dateTime(d.createdAt)}
                    </p>
                  </div>
                  <div className="text-right">
                    <p className="font-display text-base font-bold">{birr(d.amount)}</p>
                    <p className="text-[10px] text-ink-3">held in escrow</p>
                  </div>
                </div>

                {!closed && (
                  <div className={clsx('mt-3 flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-[11px]', hoursLeft < 0 ? 'bg-bad-soft text-bad' : 'bg-warn-soft text-warn')}>
                    <Clock className="size-3 shrink-0" />
                    {hoursLeft < 0
                      ? `The ${d.slaHours}-hour decision window passed ${until(d.dueAt)} ago. The seller has been notified.`
                      : `Decision due in ${until(d.dueAt)} — a mediator reviews the evidence and writes a reason.`}
                  </div>
                )}

                {d.resolution && (
                  <Notice tone={d.resolution.outcome === 'release_to_seller' ? 'info' : 'warn'} className="mt-3">
                    <span className="font-semibold">{d.resolution.outcome.replace(/_/g, ' ')} · {birr(d.resolution.amount)}</span>
                    <p className="mt-0.5">{d.resolution.note}</p>
                  </Notice>
                )}

                <Button
                  size="sm"
                  variant="ghost"
                  className="mt-2"
                  icon={<MessageSquare className="size-3.5" />}
                  onClick={() => setExpanded(open ? null : d.id)}
                >
                  {open ? 'Hide' : 'Show'} the case thread ({d.structuredThread.length})
                </Button>

                {open && (
                  <div className="mt-3 space-y-3 border-t border-line pt-3">
                    <ol className="space-y-2.5">
                      {d.structuredThread.map((t) => (
                        <li key={t.id} className="flex gap-2.5">
                          <Badge tone={t.by === 'mediator' ? 'violet' : t.by === 'buyer' ? 'info' : 'muted'}>
                            {t.by}
                          </Badge>
                          <div className="min-w-0 flex-1">
                            <p className="text-xs leading-relaxed">{t.body}</p>
                            <p className="text-[10px] text-ink-3">{dateTime(t.at)} · reason code {t.reasonCode}</p>
                          </div>
                        </li>
                      ))}
                    </ol>

                    {d.evidence.length > 0 && (
                      <div>
                        <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Evidence on file</p>
                        <div className="flex flex-wrap gap-2">
                          {d.evidence.map((e) => (
                            <a key={e.id} href={e.url} target="_blank" rel="noreferrer" className="block">
                              <img src={e.url} alt={e.kind} className="size-16 rounded-md border border-line object-cover" />
                              <span className="mt-0.5 block text-[10px] text-ink-3">{e.kind} · {e.uploadedBy}</span>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}

                    {!closed && <MessageBox disputeId={d.id} onSent={reload} />}
                  </div>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <Notice tone="warn" title="Keep evidence, not just opinions">
        <span className="flex items-start gap-1.5">
          <AlertTriangle className="mt-0.5 size-3 shrink-0" />
          Photos of the packaging, the item and the delivery label decide most cases. Screenshots of chat help too.
          A dispute that cannot be evidenced usually cannot be won — that cuts both ways.
        </span>
      </Notice>
    </div>
  );
}

function MessageBox({ disputeId, onSent }: { disputeId: string; onSent: () => void }) {
  const [body, setBody] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function send(e: React.FormEvent) {
    e.preventDefault();
    if (!body.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await api.post(`/disputes/${disputeId}/message`, { body: body.trim() });
      setBody('');
      onSent();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not send that.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <form onSubmit={send} className="border-t border-line pt-3">
      <Field label="Add to the case" error={err ?? undefined}>
        <Textarea rows={3} value={body} onChange={(e) => setBody(e.target.value)} placeholder="Add a detail, a photo reference, or a reply to the seller's statement." />
      </Field>
      <Button type="submit" size="sm" variant="secondary" className="mt-2" loading={busy} disabled={!body.trim()}>
        Add to case
      </Button>
    </form>
  );
}
