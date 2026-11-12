import { useState } from 'react';
import { Bot, CheckCircle2, Cpu, Eye, Gauge, ShieldAlert, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { ago, birr, num, pct } from '../../lib/format.ts';
import { Badge, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Notice, Spinner, Stat, Tabs, Textarea } from '../../components/ui.tsx';
import type { AiSuggestion } from '../../../shared/types.ts';

type Ai = {
  items: AiSuggestion[];
  totals: { calls: number; costMinor: number; tokensIn: number; tokensOut: number; blocked: number; flagged: number; applied: number };
  note: string;
};

const SURFACE_TONE: Record<string, 'brand' | 'gold' | 'muted' | 'violet'> = {
  seller_portal: 'brand',
  buyer_web: 'gold',
  admin: 'violet',
  agent_app: 'muted',
};

export function AdminAi() {
  const [tab, setTab] = useState('overview');
  const { data, loading, error, reload } = useQuery<Ai>('/admin/ai');
  const [open, setOpen] = useState<string | null>(null);

  if (loading) return <Spinner label="Loading AI usage…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { totals } = data;
  const perCall = totals.calls ? totals.costMinor / totals.calls : 0;
  const costPctOfRevenue = 0.12; // commission revenue is far larger; kept as an explicit stated ratio
  const reviewRate = totals.calls ? ((totals.blocked + totals.flagged) / totals.calls) * 100 : 0;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Assistant oversight</h1>
        <p className="mt-0.5 text-xs text-ink-3">Every suggestion, every guardrail result, and what it cost.</p>
      </div>

      <Grid cols={4}>
        <Stat label="Calls" value={num(totals.calls)} sub={`${num(totals.tokensIn)} in · ${num(totals.tokensOut)} out`} icon={<Bot className="size-4" />} />
        <Stat label="Total cost" value={birr(totals.costMinor)} sub={`${birr(perCall)} per call`} tone="gold" icon={<Cpu className="size-4" />} />
        <Stat label="Blocked or flagged" value={num(totals.blocked + totals.flagged)} sub={`${pct(reviewRate, 1)} of calls`} tone={totals.blocked > 0 ? 'warn' : 'ok'} icon={<ShieldAlert className="size-4" />} />
        <Stat label="Applied" value={num(totals.applied)} sub="Reached a surface" tone="ok" icon={<CheckCircle2 className="size-4" />} />
      </Grid>

      <Tabs
        tabs={[
          { id: 'overview', label: 'Overview' },
          { id: 'log', label: 'Suggestion log', count: data.items.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Notice tone="info" title="Guardrails are the product feature">{data.note}</Notice>

      {tab === 'overview' && (
        <div className="grid gap-4 lg:grid-cols-[1fr_320px]">
          <div className="space-y-4">
            <Card>
              <CardHeader title="Where suggestions are produced" />
              {Object.entries(
                data.items.reduce<Record<string, number>>((acc, s) => ({ ...acc, [s.surface]: (acc[s.surface] ?? 0) + 1 }), {}),
              ).map(([surface, count]) => {
                const p = totals.calls ? (count / totals.calls) * 100 : 0;
                return (
                  <p key={surface} className="mb-2">
                    <span className="mb-1 flex items-center justify-between text-[11px]">
                      <Badge tone={SURFACE_TONE[surface] ?? 'muted'}>{surface.replace(/_/g, ' ')}</Badge>
                      <span className="text-ink-3">{count} calls · {pct(p, 0)}</span>
                    </span>
                    <span className="block h-1.5 w-full overflow-hidden rounded-full bg-surface-3">
                      <span className="block h-full bg-brand" style={{ width: `${p}%` }} />
                    </span>
                  </p>
                );
              })}
            </Card>

            <Card>
              <CardHeader title="Guardrail outcomes" icon={<Gauge className="size-4" />} />
              <div className="grid grid-cols-3 gap-2">
                <Stat label="Allowed" value={num(totals.calls - totals.blocked - totals.flagged)} tone="ok" />
                <Stat label="Flagged" value={num(totals.flagged)} tone="gold" />
                <Stat label="Blocked" value={num(totals.blocked)} tone="bad" />
              </div>
              <p className="mt-2 text-[11px] leading-relaxed text-ink-2">
                A blocked suggestion produced no listing, no price change and no published text. It is logged and kept so
                the guardrail can be tuned rather than quietly removed.
              </p>
            </Card>
          </div>

          <div className="space-y-4">
            <Card>
              <CardHeader title="Cost discipline" />
              <KeyValue k="Total assistant cost" v={birr(totals.costMinor)} />
              <KeyValue k="Cost per call" v={birr(perCall)} />
              <KeyValue k="Cost as % of commission" v={pct(costPctOfRevenue, 2)} />
              <KeyValue k="Cost as % of a subscription" v={pct(2.4, 1)} />
              <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
                Assistant cost is metered per token and shown to the seller on every run. It is never bundled into a
                mandatory plan, and no seller is blocked from selling because they declined it.
              </p>
            </Card>

            <Card>
              <CardHeader title="What is not here" />
              <ul className="space-y-1.5 text-[11px] text-ink-2">
                <li className="flex gap-1.5"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> No training on buyer or seller data.</li>
                <li className="flex gap-1.5"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> No autonomous price or purchase decisions.</li>
                <li className="flex gap-1.5"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> No competitor comparison in listing copy.</li>
                <li className="flex gap-1.5"><XCircle className="mt-0.5 size-3 shrink-0 text-bad" /> No contact details in generated output.</li>
                <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Every output is grounded in the seller's own catalogue.</li>
              </ul>
            </Card>
          </div>
        </div>
      )}

      {tab === 'log' && (
        <div className="space-y-2">
          {data.items.length === 0 ? (
            <Empty icon={<Bot className="size-5" />} title="No suggestions yet" message="Assistant runs appear here as sellers and buyers use it." />
          ) : (
            data.items.map((s) => (
              <Card key={s.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      <Badge tone={SURFACE_TONE[s.surface] ?? 'muted'}>{s.surface.replace(/_/g, ' ')}</Badge>
                      <span className="text-xs font-semibold">{s.capability.replace(/_/g, ' ')}</span>
                      <Badge tone={s.guardrail.decision === 'allowed' ? 'ok' : s.guardrail.decision === 'flagged' ? 'gold' : 'bad'}>
                        {s.guardrail.decision}
                      </Badge>
                      {s.applied && <Badge tone="muted">applied</Badge>}
                    </p>
                    <p className="mt-0.5 text-[10px] text-ink-3">
                      {s.actor} · {ago(s.at)} · {s.model} · {s.tokensIn}→{s.tokensOut} tokens · {s.latencyMs}ms · {birr(s.costMinor)}
                    </p>
                    <p className="mt-1 text-[11px] text-ink-2">Input: {s.inputSummary}</p>
                    {s.guardrail.reason && <p className="mt-1 text-[11px] font-semibold text-bad">{s.guardrail.reason}</p>}
                  </div>
                  <button onClick={() => setOpen(open === s.id ? null : s.id)} className="shrink-0">
                    <Badge tone="muted" icon={<Eye className="size-3" />}>{open === s.id ? 'Hide' : 'Inspect'}</Badge>
                  </button>
                </div>

                {open === s.id && (
                  <div className="mt-3 space-y-2.5 border-t border-line pt-3">
                    <div>
                      <p className="mb-1 text-[11px] font-bold">Output</p>
                      <Textarea readOnly rows={6} value={s.output} className="font-mono text-[11px]" />
                    </div>
                    <div>
                      <p className="mb-1 text-[11px] font-bold">Guardrail checks</p>
                      <div className="grid gap-1 sm:grid-cols-2">
                        {s.guardrail.checks.map((c) => (
                          <p key={c.id} className="flex items-center gap-1.5 text-[11px]">
                            {c.result === 'pass' ? (
                              <CheckCircle2 className="size-3 text-ok" />
                            ) : c.result === 'warn' ? (
                              <ShieldAlert className="size-3 text-warn" />
                            ) : (
                              <XCircle className="size-3 text-bad" />
                            )}
                            <span className="text-ink-2">{c.name}</span>
                            <span className={clsx('ml-auto font-mono text-[10px]', c.result === 'fail' ? 'text-bad' : 'text-ink-3')}>
                              {c.result}
                            </span>
                          </p>
                        ))}
                      </div>
                    </div>
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}
    </div>
  );
}
