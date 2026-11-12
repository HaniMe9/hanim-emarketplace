import { useState } from 'react';
import { CheckCircle2, Clock, FileCheck2, MessageSquare, Scale, ShieldCheck, Star, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, birr, titleCase, until } from '../../lib/format.ts';
import { Badge, Button, Card, Empty, ErrorNote, Field, Grid, Input, Notice, Select, Spinner, Stat, StatusBadge, Tabs, Textarea } from '../../components/ui.tsx';
import type { Dispute, Id, VerificationCase } from '../../../shared/types.ts';

type QueueItem = {
  type: 'listing' | 'dispute' | 'verification' | 'review';
  id: string;
  org: string;
  title: string;
  at: string;
  risk: 'low' | 'medium' | 'high';
  reason: string;
  slaHours?: number;
  dueAt?: string;
};

type Disputes = { items: Dispute[] };

export function AdminModeration() {
  const [tab, setTab] = useState('queue');
  const { data, loading, error, reload } = useQuery<{ queue: QueueItem[]; counts: Record<string, number> }>('/admin/moderation');

  if (loading) return <Spinner label="Loading moderation queue…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { queue, counts } = data;
  const overdue = queue.filter((q) => q.dueAt && new Date(q.dueAt) < new Date()).length;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Moderation</h1>
        <p className="mt-0.5 text-xs text-ink-3">Listings, disputes, verifications and held reviews — every one needs a human decision.</p>
      </div>

      <Grid cols={5}>
        <Stat label="Queue" value={String(queue.length)} tone={queue.length > 0 ? 'warn' : 'ok'} />
        <Stat label="Listings" value={String(counts.listing ?? 0)} />
        <Stat label="Disputes" value={String(counts.dispute ?? 0)} tone={counts.dispute ? 'warn' : 'muted'} />
        <Stat label="Verifications" value={String(counts.verification ?? 0)} />
        <Stat label="Past SLA" value={String(overdue)} tone={overdue > 0 ? 'bad' : 'ok'} />
      </Grid>

      <Tabs
        tabs={[
          { id: 'queue', label: 'Queue', count: queue.length },
          { id: 'disputes', label: 'Disputes' },
          { id: 'kyc', label: 'Verifications' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {tab === 'queue' && (
        queue.length === 0 ? (
          <Empty icon={<CheckCircle2 className="size-5" />} title="Queue is clear" message="Nothing is waiting on a reviewer." />
        ) : (
          <div className="space-y-2">
            {queue.map((q) => (
              <QueueRow key={`${q.type}:${q.id}`} item={q} onDone={reload} />
            ))}
          </div>
        )
      )}

      {tab === 'disputes' && <DisputeDesk />}
      {tab === 'kyc' && <KycDesk />}
    </div>
  );
}

function QueueRow({ item, onDone }: { item: QueueItem; onDone: () => void }) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState('');
  const [outcome, setOutcome] = useState<'refund_full' | 'refund_partial' | 'return_and_refund' | 'release_to_seller'>('refund_full');
  const [amount, setAmount] = useState('');
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [open, setOpen] = useState(false);
  const late = item.dueAt ? new Date(item.dueAt) < new Date() : false;

  async function act(action: 'approve' | 'reject' | 'escalate' | 'resolve') {
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message?: string }>(`/admin/moderation/${item.type}/${item.id}`, {
        action,
        note: note.trim() || undefined,
        outcome: item.type === 'dispute' && action === 'resolve' ? outcome : undefined,
        amount: item.type === 'dispute' && action === 'resolve' && amount ? Math.round(Number(amount) * 100) : undefined,
      });
      setMsg(r.message ?? `${titleCase(item.type)} ${action}d.`);
      onDone();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'That decision could not be recorded.');
    } finally {
      setBusy(false);
    }
  }

  const ACTIONS: { id: 'approve' | 'reject' | 'escalate' | 'resolve'; label: string; variant: 'primary' | 'secondary' | 'ghost' | 'danger' }[] =
    item.type === 'listing'
      ? [
          { id: 'approve', label: 'Approve and publish', variant: 'primary' },
          { id: 'reject', label: 'Reject', variant: 'danger' },
        ]
      : item.type === 'verification'
        ? [
            { id: 'approve', label: 'Approve tier', variant: 'primary' },
            { id: 'reject', label: 'Reject', variant: 'danger' },
            { id: 'escalate', label: 'Escalate to compliance', variant: 'secondary' },
          ]
        : item.type === 'review'
          ? [
              { id: 'approve', label: 'Publish review', variant: 'primary' },
              { id: 'reject', label: 'Remove', variant: 'danger' },
            ]
          : [
              { id: 'resolve', label: 'Resolve dispute', variant: 'primary' },
              { id: 'escalate', label: 'Escalate', variant: 'secondary' },
            ];

  return (
    <Card className={clsx(item.risk === 'high' && 'border-bad/30', late && 'border-warn/40')}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0 flex-1">
          <p className="flex flex-wrap items-center gap-1.5">
            <Badge tone={item.type === 'dispute' ? 'violet' : item.type === 'verification' ? 'brand' : item.type === 'review' ? 'gold' : 'muted'}>
              {item.type}
            </Badge>
            <span className="text-sm font-semibold">{item.title}</span>
            <Badge tone={item.risk === 'high' ? 'bad' : item.risk === 'medium' ? 'warn' : 'muted'}>{item.risk} risk</Badge>
          </p>
          <p className="mt-0.5 text-[11px] text-ink-3">
            {item.org} · <span className="font-mono">{item.id}</span> · submitted {ago(item.at)}
          </p>
          <p className="mt-1 text-[11px] text-ink-2">{item.reason}</p>
          {item.dueAt && (
            <p className={clsx('mt-1 flex items-center gap-1 text-[11px] font-semibold', late ? 'text-bad' : 'text-ink-3')}>
              <Clock className="size-3" /> SLA {item.slaHours}h · {late ? `overdue by ${ago(item.dueAt).replace(' ago', '')}` : `due ${until(item.dueAt)}`}
            </p>
          )}
        </div>
        <Button size="sm" variant="ghost" onClick={() => setOpen((v) => !v)}>
          {open ? 'Hide' : 'Decide'}
        </Button>
      </div>

      {msg && <Notice tone="ok" className="mt-3" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <div className="mt-3"><ErrorNote message={err} /></div>}

      {open && (
        <div className="mt-3 space-y-2.5 border-t border-line pt-3">
          {item.type === 'dispute' && (
            <div className="grid gap-2 sm:grid-cols-2">
              <Field label="Outcome">
                <Select value={outcome} onChange={(e) => setOutcome(e.target.value as typeof outcome)}>
                  <option value="refund_full">Full refund to buyer</option>
                  <option value="refund_partial">Partial refund</option>
                  <option value="return_and_refund">Return and refund</option>
                  <option value="release_to_seller">Release to seller</option>
                </Select>
              </Field>
              <Field label="Amount (ETB)" hint="Leave blank for the full disputed amount">
                <Input type="number" step="0.01" min="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
              </Field>
            </div>
          )}
          <Field label="Reviewer note" hint="Stored in the audit log and visible to both parties">
            <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="What you checked and why you decided this." />
          </Field>
          <div className="flex flex-wrap gap-2">
            {ACTIONS.map((a) => (
              <Button key={a.id} size="sm" variant={a.variant} loading={busy} onClick={() => void act(a.id)}>
                {a.label}
              </Button>
            ))}
          </div>
          <p className="text-[10px] text-ink-3">Every decision is written to the audit log with the before and after state.</p>
        </div>
      )}
    </Card>
  );
}

function DisputeDesk() {
  const { data, loading, error, reload } = useQuery<Disputes>('/admin/disputes');
  const [openId, setOpenId] = useState<Id | null>(null);
  if (loading) return <Spinner label="Loading disputes…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  const items = data?.items ?? [];
  return (
    <div className="space-y-2">
      {items.length === 0 ? (
        <Empty icon={<Scale className="size-5" />} title="No disputes" message="Buyer funds stay in escrow while any case is open." />
      ) : (
        items.map((d) => (
          <Card key={d.id} className="p-0">
            <button onClick={() => setOpenId(openId === d.id ? null : d.id)} className="w-full p-3.5 text-left">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[11px] font-bold">{d.code}</span>
                    <StatusBadge status={d.status} />
                    <Badge tone="muted">{d.reason.replace(/_/g, ' ')}</Badge>
                    {d.resolution && <Badge tone="ok">resolved</Badge>}
                  </p>
                  <p className="mt-0.5 text-xs text-ink-2">{d.summary}</p>
                  <p className="mt-0.5 text-[10px] text-ink-3">
                    {d.buyerName} vs {d.sellerName} · order {d.orderCode} · opened {ago(d.createdAt)} · SLA {d.slaHours}h
                  </p>
                </div>
                <div className="text-right">
                  <p className="font-display text-base font-bold">{birr(d.amount)}</p>
                  <p className="text-[10px] text-ink-3">in escrow</p>
                </div>
              </div>
            </button>

            {openId === d.id && (
              <div className="space-y-3 border-t border-line bg-surface-2/50 p-3.5">
                <div>
                  <p className="mb-1 text-[11px] font-bold">Evidence ({d.evidence.length})</p>
                  {d.evidence.length === 0 ? (
                    <p className="text-[11px] text-ink-3">No evidence attached.</p>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      {d.evidence.map((e) => (
                        <span key={e.id} className="flex items-center gap-1.5 rounded border border-line bg-surface px-2 py-1 text-[10px]">
                          <FileCheck2 className="size-3" /> {e.kind} · {e.uploadedBy}
                        </span>
                      ))}
                    </div>
                  )}
                </div>

                <div>
                  <p className="mb-1 flex items-center gap-1 text-[11px] font-bold"><MessageSquare className="size-3" /> Structured thread</p>
                  <div className="space-y-1.5">
                    {d.structuredThread.map((t) => (
                      <div key={t.id} className="rounded border border-line bg-surface p-2">
                        <p className="text-[10px] text-ink-3">
                          <b className="text-ink-2">{t.by}</b> · {ago(t.at)} · {t.reasonCode.replace(/_/g, ' ')}
                        </p>
                        <p className="mt-0.5 text-[11px]">{t.body}</p>
                      </div>
                    ))}
                  </div>
                </div>

                {d.resolution ? (
                  <Notice tone="ok" title={`Resolved: ${d.resolution.outcome.replace(/_/g, ' ')}`}>
                    {birr(d.resolution.amount)} · {d.resolution.note} · {ago(d.resolution.at)}
                  </Notice>
                ) : (
                  <p className="text-[11px] text-ink-3">Resolve it from the Queue tab — the outcome and amount are written to the audit log.</p>
                )}
              </div>
            )}
          </Card>
        ))
      )}
    </div>
  );
}

function KycDesk() {
  const { data, loading, error, reload } = useQuery<{
    items: (VerificationCase & { org: { logoText: string; trustScore: number } | null; hoursLeft: number; failedChecks: { name: string; note: string }[]; pendingChecks: { name: string }[] })[];
    backlog: number;
  }>('/admin/verifications');
  if (loading) return <Spinner label="Loading verifications…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;

  return (
    <div className="space-y-3">
      <Notice tone="info" title={`${data?.backlog ?? 0} in backlog`}>
        A tier badge is never granted on trust score alone. Every tier requires a document check and a named reviewer.
      </Notice>
      {(data?.items.length ?? 0) === 0 ? (
        <Empty icon={<ShieldCheck className="size-5" />} title="No verification cases" message="Nothing submitted right now." />
      ) : (
        data!.items.map((v) => (
          <Card key={v.id}>
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="flex flex-wrap items-center gap-2">
                  <span className="text-sm font-semibold">{v.orgName}</span>
                  <StatusBadge status={v.status} />
                  <Badge tone="muted">{v.submittedTier}</Badge>
                  {v.org && <Badge tone={v.org.trustScore >= 80 ? 'ok' : 'warn'}>trust {v.org.trustScore}</Badge>}
                </p>
                <p className="mt-0.5 font-mono text-[10px] text-ink-3">{v.id} · {v.orgType} · submitted {ago(v.submittedAt)}</p>
              </div>
              <div className="text-right">
                <p className="font-display text-sm font-bold">{v.score}/100</p>
                <p className={clsx('text-[10px]', v.hoursLeft < 0 ? 'text-bad' : 'text-ink-3')}>
                  {v.hoursLeft < 0 ? `SLA breached ${Math.abs(v.hoursLeft)}h ago` : `${v.hoursLeft}h left`}
                </p>
              </div>
            </div>

            <div className="mt-2.5 grid gap-2 sm:grid-cols-2">
              <div>
                <p className="mb-1 text-[11px] font-bold">Checks</p>
                {v.checks.map((c) => (
                  <p key={c.id} className="flex items-start gap-1.5 text-[11px]">
                    {c.status === 'pass' ? (
                      <CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" />
                    ) : c.status === 'fail' ? (
                      <XCircle className="mt-0.5 size-3 shrink-0 text-bad" />
                    ) : c.status === 'waived' ? (
                      <Star className="mt-0.5 size-3 shrink-0 text-ink-3" />
                    ) : (
                      <Clock className="mt-0.5 size-3 shrink-0 text-warn" />
                    )}
                    <span>
                      <b className="font-semibold">{c.name}</b> <span className="text-ink-3">({c.weight})</span>
                      {c.note && <span className="block text-[10px] text-ink-3">{c.note}</span>}
                    </span>
                  </p>
                ))}
              </div>
              <div>
                <p className="mb-1 text-[11px] font-bold">Documents ({v.documents.length})</p>
                {v.documents.length === 0 ? (
                  <p className="text-[11px] text-bad">No documents uploaded. Cannot be approved.</p>
                ) : (
                  v.documents.map((d) => (
                    <p key={d.id} className="flex items-center gap-1.5 text-[11px]">
                      <FileCheck2 className="size-3 text-ink-3" /> {d.kind} <span className="text-ink-3">· {ago(d.uploadedAt)}</span>
                    </p>
                  ))
                )}
                {v.blocking.length > 0 && (
                  <Notice tone="bad" title="Blocking" className="mt-2">
                    {v.blocking.map((b) => b.reason).join(' · ')}
                  </Notice>
                )}
              </div>
            </div>
          </Card>
        ))
      )}
    </div>
  );
}

