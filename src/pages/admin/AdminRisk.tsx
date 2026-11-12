import { useState } from 'react';
import { AlertTriangle, CheckCircle2, Eye, Gauge, ShieldAlert, ShieldCheck, Sliders } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, num, pct } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Notice, Select, Spinner, Stat, Tabs } from '../../components/ui.tsx';
import type { RiskEvaluation, RiskRule } from '../../../shared/types.ts';

type Risk = {
  rules: RiskRule[];
  evaluations: RiskEvaluation[];
  decisions: Record<string, number>;
  note: string;
};

const ACTION_TONE: Record<RiskRule['action'], 'muted' | 'warn' | 'bad' | 'gold'> = {
  flag: 'muted',
  hold: 'warn',
  block: 'bad',
  require_otp: 'gold',
};

const ACTION_HELP: Record<RiskRule['action'], string> = {
  flag: 'Records the signal and continues. The buyer and seller are unaffected.',
  hold: 'Stops the order from progressing until a human clears it. Money stays in escrow.',
  block: 'Refuses the order outright. The buyer is told why, not given a silent failure.',
  require_otp: 'Demands a one-time code from the buyer before the order is accepted.',
};

export function AdminRisk() {
  const [tab, setTab] = useState('rules');
  const { data, loading, error, reload } = useQuery<Risk>('/admin/risk');
  const [busy, setBusy] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  if (loading) return <Spinner label="Loading risk configuration…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const enabled = data.rules.filter((r) => r.enabled);
  const totalHits = data.rules.reduce((a, r) => a + r.hits30d, 0);
  const avgFp = enabled.length ? enabled.reduce((a, r) => a + r.falsePositiveRate, 0) / enabled.length : 0;
  const blocks = (data.decisions.block ?? 0) + (data.decisions.review ?? 0);

  async function update(id: string, body: { enabled?: boolean; action?: RiskRule['action'] }) {
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.patch<{ message: string }>(`/admin/risk/rules/${id}`, body);
      setMsg(r.message);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not update that rule.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Risk</h1>
        <p className="mt-0.5 text-xs text-ink-3">Transparent rules with measured false-positive rates, not an unexplainable score.</p>
      </div>

      <Grid cols={4}>
        <Stat label="Active rules" value={`${enabled.length} / ${data.rules.length}`} icon={<ShieldCheck className="size-4" />} />
        <Stat label="Hits 30d" value={num(totalHits)} />
        <Stat label="Avg false-positive rate" value={`${avgFp.toFixed(1)}%`} tone={avgFp > 5 ? 'warn' : 'ok'} icon={<Gauge className="size-4" />} />
        <Stat label="Orders held or blocked" value={num(blocks)} tone={blocks > 0 ? 'gold' : 'muted'} icon={<ShieldAlert className="size-4" />} />
      </Grid>

      <Tabs
        tabs={[
          { id: 'rules', label: 'Rules', count: data.rules.length },
          { id: 'evaluations', label: 'Evaluations', count: data.evaluations.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Notice tone="info" title="No fraud model">{data.note}</Notice>
      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {tab === 'rules' && (
        <div className="space-y-2">
          {data.rules.map((r) => (
            <Card key={r.id} className={clsx(r.enabled ? '' : 'opacity-70')}>
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0 flex-1">
                  <p className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-[10px] text-ink-3">{r.id}</span>
                    <span className="text-sm font-semibold">{r.label}</span>
                    <Badge tone={r.severity === 'high' ? 'bad' : r.severity === 'medium' ? 'warn' : 'muted'}>{r.severity}</Badge>
                    <Badge tone={ACTION_TONE[r.action]}>{r.action.replace(/_/g, ' ')}</Badge>
                    {!r.enabled && <Badge tone="muted">disabled</Badge>}
                  </p>
                  <p className="mt-0.5 text-[11px] text-ink-2">{r.description}</p>
                  <p className="mt-1 text-[10px] text-ink-3">
                    {num(r.hits30d)} hits in 30d · {r.falsePositiveRate}% false positives · {ACTION_HELP[r.action]}
                  </p>
                  {Object.keys(r.params).length > 0 && (
                    <p className="mt-1 flex flex-wrap gap-1.5">
                      {Object.entries(r.params).map(([k, v]) => (
                        <span key={k} className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-ink-3">
                          {k}={String(v)}
                        </span>
                      ))}
                    </p>
                  )}
                </div>

                <div className="flex shrink-0 flex-wrap items-center gap-2">
                  <Select
                    value={r.action}
                    onChange={(e) => void update(r.id, { action: e.target.value as RiskRule['action'] })}
                    className="h-8 w-32 text-[11px]"
                  >
                    <option value="flag">flag</option>
                    <option value="hold">hold</option>
                    <option value="block">block</option>
                    <option value="require_otp">require OTP</option>
                  </Select>
                  <Button
                    size="sm"
                    variant={r.enabled ? 'ghost' : 'secondary'}
                    loading={busy === r.id}
                    onClick={() => void update(r.id, { enabled: !r.enabled })}
                    icon={r.enabled ? <AlertTriangle className="size-3.5" /> : <CheckCircle2 className="size-3.5" />}
                  >
                    {r.enabled ? 'Disable' : 'Enable'}
                  </Button>
                </div>
              </div>
            </Card>
          ))}
        </div>
      )}

      {tab === 'evaluations' && (
        <div className="space-y-2">
          {data.evaluations.length === 0 ? (
            <Empty icon={<Eye className="size-4" />} title="No evaluations" message="Orders are evaluated against the rules as they are placed." />
          ) : (
            data.evaluations.map((e, i) => (
              <Card key={`${e.orderId ?? 'x'}-${i}`} className={clsx(e.decision !== 'allow' && 'border-warn/30')}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    <p className="flex flex-wrap items-center gap-2">
                      {e.orderId && <span className="font-mono text-[11px] font-bold">{e.orderId}</span>}
                      <Badge tone={e.decision === 'allow' ? 'ok' : e.decision === 'review' ? 'warn' : 'bad'}>{e.decision}</Badge>
                      <span className="text-[11px] text-ink-3">{ago(e.at)}</span>
                    </p>
                    {e.triggered.length > 0 ? (
                      <div className="mt-1.5 space-y-1">
                        {e.triggered.map((t, j) => (
                          <p key={j} className="flex items-start gap-1.5 text-[11px]">
                            <ShieldAlert className={clsx('mt-0.5 size-3 shrink-0', t.severity === 'high' ? 'text-bad' : t.severity === 'medium' ? 'text-warn' : 'text-ink-3')} />
                            <span>
                              <b className="font-semibold">{t.label}</b>
                              <span className="block text-[10px] text-ink-3">{t.detail}</span>
                            </span>
                          </p>
                        ))}
                      </div>
                    ) : (
                      <p className="mt-1 text-[11px] text-ok">No rules triggered.</p>
                    )}
                  </div>
                  <div className="text-right">
                    <p className="font-display text-lg font-bold">{e.score}</p>
                    <p className="text-[10px] text-ink-3">score</p>
                  </div>
                </div>
                {e.signals.length > 0 && (
                  <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 border-t border-line pt-2">
                    {e.signals.map((s, j) => (
                      <span key={j} className="text-[10px] text-ink-3">
                        {s.label}: <b className="text-ink-2">{s.value}</b>
                      </span>
                    ))}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      <Card className="bg-surface-2/60">
        <CardHeader title="Design constraints" icon={<Sliders className="size-4" />} />
        <div className="grid gap-2 sm:grid-cols-2">
          <KeyValue k="Decisions recorded" v={Object.entries(data.decisions).map(([k, v]) => `${k} ${v}`).join(' · ') || 'none yet'} />
          <KeyValue k="Rules disabled" v={String(data.rules.length - enabled.length)} />
          <KeyValue k="Highest FP rate" v={pct(Math.max(...data.rules.map((r) => r.falsePositiveRate), 0))} />
          <KeyValue k="Blocking rules" v={String(data.rules.filter((r) => r.enabled && (r.action === 'block' || r.action === 'hold')).length)} />
        </div>
        <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
          A rule with a high false-positive rate blocks real buyers, which is worse than a missed fraud case. Every
          change is audited.
        </p>
      </Card>
    </div>
  );
}
