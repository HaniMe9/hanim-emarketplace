import { useState } from 'react';
import { Banknote, CheckCircle2, Lock, Scale, Undo2 } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, birr, dateOnly, moneyShort, num } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Field, Grid, Input, KeyValue, Notice, Select, Spinner, Stat, StatusBadge, Tabs } from '../../components/ui.tsx';
import type { CodDeposit, Id, ReconciliationRun, Settlement } from '../../../shared/types.ts';

type Recon = {
  runs: ReconciliationRun[];
  codDeposits: CodDeposit[];
  shortfalls: CodDeposit[];
  blockedSettlements: Settlement[];
  note: string;
};

const SCOPES: Record<string, string> = {
  psp: 'Payment service provider',
  cod_remittance: 'Cash-on-delivery remittance',
  payouts: 'Seller payouts',
  bank: 'Bank statement',
};

export function AdminReconciliation() {
  const [tab, setTab] = useState('cash');
  const { data, loading, error, reload } = useQuery<Recon>('/admin/reconciliation');
  const [busy, setBusy] = useState<Id | null>(null);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [editing, setEditing] = useState<Id | null>(null);
  const [received, setReceived] = useState('');
  const [reference, setReference] = useState('');
  const [method, setMethod] = useState<CodDeposit['method']>('CBE Birr');

  if (loading) return <Spinner label="Loading reconciliation…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const shortTotal = data.shortfalls.reduce((a, d) => a + Math.max(0, d.variance), 0);
  const blockedValue = data.blockedSettlements.reduce((a, s) => a + s.netPayable, 0);
  const openExceptions = data.runs.reduce((a, r) => a + r.exceptions.filter((e) => e.resolution === 'open').length, 0);

  async function reconcile(id: Id) {
    setBusy(id);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message: string; cleared: boolean; stillBlocked: string[] }>(`/admin/reconciliation/cod/${id}`, {
        received: Math.round(Number(received) * 100),
        reference: reference.trim() || undefined,
        method,
      });
      setMsg(`${r.message}${r.stillBlocked.length > 0 ? ` Still blocked: ${r.stillBlocked.join(', ')}.` : ''}`);
      setEditing(null);
      setReceived('');
      setReference('');
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not record that remittance.');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Reconciliation</h1>
        <p className="mt-0.5 text-xs text-ink-3">Money in, money out, and every difference named rather than written off.</p>
      </div>

      <Tabs
        tabs={[
          { id: 'cash', label: 'COD remittance', count: data.shortfalls.length },
          { id: 'runs', label: 'Reconciliation runs' },
          { id: 'blocked', label: 'Blocked payouts', count: data.blockedSettlements.length },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Grid cols={4}>
        <Stat label="Short remittances" value={String(data.shortfalls.length)} tone={data.shortfalls.length ? 'bad' : 'ok'} />
        <Stat label="Short amount" value={moneyShort(shortTotal)} tone={shortTotal > 0 ? 'bad' : 'ok'} icon={<Banknote className="size-4" />} />
        <Stat label="Blocked payouts" value={moneyShort(blockedValue)} tone={data.blockedSettlements.length ? 'warn' : 'ok'} icon={<Lock className="size-4" />} />
        <Stat label="Open exceptions" value={String(openExceptions)} tone={openExceptions ? 'warn' : 'ok'} />
      </Grid>

      <Notice tone="warn" title="How a shortfall is handled">{data.note}</Notice>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {tab === 'cash' && (
        <Card>
          <CardHeader
            title="Cash-on-delivery remittances"
            subtitle="Only money that actually reached the platform account counts"
          />
          {data.codDeposits.length === 0 ? (
            <Empty icon={<Banknote className="size-5" />} title="No deposits" message="No agent has remitted yet." />
          ) : (
            <div className="space-y-2">
              {data.codDeposits.map((d) => {
                const short = d.variance > 0;
                const isEditing = editing === d.id;
                return (
                  <div key={d.id} className={clsx('rounded-md border p-3', short ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <p className="flex flex-wrap items-center gap-2">
                          <span className="font-mono text-[11px] font-bold">{d.reference}</span>
                          <StatusBadge status={d.status} />
                          <Badge tone="muted">{d.method}</Badge>
                          <span className="text-[11px] text-ink-3">{d.agentName}</span>
                        </p>
                        <p className="mt-0.5 text-[10px] text-ink-3">
                          route {d.routeId} · due {dateOnly(d.dueAt)}
                          {d.receivedAt ? ` · received ${ago(d.receivedAt)}` : ' · not yet received'}
                        </p>
                        {d.note && <p className="mt-1 text-[11px] font-semibold text-bad">{d.note}</p>}
                      </div>
                      <div className="text-right">
                        <p className="font-mono text-sm font-bold">{birr(d.received)}</p>
                        <p className={clsx('text-[10px]', short ? 'text-bad' : 'text-ok')}>
                          {short ? `short ${birr(d.variance)}` : 'in full'}
                        </p>
                      </div>
                    </div>

                    <div className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                      <KeyValue k="Expected" v={birr(d.expected)} />
                      <KeyValue k="Received" v={birr(d.received)} />
                      <KeyValue k="Fee" v={`−${birr(d.fee)}`} />
                      <KeyValue k="Net to sellers" v={birr(d.net)} />
                    </div>

                    {short && (
                      <div className="mt-2.5 border-t border-line pt-2.5">
                        {isEditing ? (
                          <div className="grid gap-2 sm:grid-cols-[130px_1fr_150px_auto] sm:items-end">
                            <Field label="Received (ETB)" required>
                              <Input type="number" step="0.01" min="0" value={received} onChange={(e) => setReceived(e.target.value)} placeholder={String(d.expected / 100)} />
                            </Field>
                            <Field label="Bank reference">
                              <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="FT23…" className="font-mono" />
                            </Field>
                            <Field label="Method">
                              <Select value={method} onChange={(e) => setMethod(e.target.value as CodDeposit['method'])}>
                                <option>CBE Birr</option>
                                <option>Telebirr</option>
                                <option>Awash Bank</option>
                                <option>Dashen Bank</option>
                              </Select>
                            </Field>
                            <div className="flex gap-1.5">
                              <Button size="sm" variant="primary" loading={busy === d.id} onClick={() => void reconcile(d.id)}>Record</Button>
                              <Button size="sm" variant="ghost" onClick={() => setEditing(null)} icon={<Undo2 className="size-3.5" />} />
                            </div>
                          </div>
                        ) : (
                          <Button
                            size="sm"
                            variant="primary"
                            onClick={() => {
                              setEditing(d.id);
                              setReceived(String(d.received / 100));
                              setReference(d.reference);
                              setMethod(d.method);
                            }}
                            icon={<Banknote className="size-3.5" />}
                          >
                            Record what actually arrived
                          </Button>
                        )}
                        <p className="mt-1.5 text-[10px] text-ink-3">
                          Record the amount that really landed. It does not clear until it adds up — a deposit that still
                          does not balance stays short and keeps holding the payout.
                        </p>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </Card>
      )}

      {tab === 'runs' && (
        <div className="space-y-2">
          {data.runs.length === 0 ? (
            <Empty icon={<Scale className="size-5" />} title="No runs" message="Reconciliation has not been executed yet." />
          ) : (
            data.runs.map((run) => (
              <Card key={run.id}>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-bold">{run.id}</span>
                      <StatusBadge status={run.status} />
                      {run.payoutBlocked && <Badge tone="bad" icon={<Lock className="size-3" />}>Payout blocked</Badge>}
                    </p>
                    <p className="mt-0.5 text-xs text-ink-2">{SCOPES[run.scope] ?? run.scope} · {run.counterparty}</p>
                    <p className="mt-0.5 text-[10px] text-ink-3">{ago(run.at)} · {num(run.records)} records</p>
                  </div>
                  <div className="text-right">
                    <p className="font-mono text-sm font-bold">{birr(run.netDifference)}</p>
                    <p className="text-[10px] text-ink-3">net difference</p>
                  </div>
                </div>

                <div className="mt-2.5 grid grid-cols-4 gap-2 text-center">
                  <Stat label="Matched" value={num(run.matched)} tone="ok" />
                  <Stat label="Mismatched" value={num(run.mismatched)} tone={run.mismatched ? 'warn' : 'muted'} />
                  <Stat label="Missing" value={num(run.missing)} tone={run.missing ? 'bad' : 'muted'} />
                  <Stat label="Exceptions" value={num(run.exceptions.length)} />
                </div>

                {run.exceptions.length > 0 && (
                  <div className="mt-3 space-y-1.5 border-t border-line pt-2.5">
                    {run.exceptions.map((e) => (
                      <div key={e.id} className="flex flex-wrap items-start justify-between gap-2 rounded border border-line p-2 text-[11px]">
                        <div className="min-w-0">
                          <p className="flex flex-wrap items-center gap-1.5">
                            <Badge tone={e.kind === 'late_remittance' ? 'warn' : e.kind === 'missing_payout' ? 'bad' : 'gold'}>{e.kind.replace(/_/g, ' ')}</Badge>
                            <span className="font-mono text-[10px] text-ink-3">{e.ref}</span>
                            <Badge tone={e.resolution === 'resolved' ? 'ok' : e.resolution === 'investigating' ? 'warn' : 'bad'}>{e.resolution}</Badge>
                          </p>
                          <p className="mt-0.5 text-ink-2">{e.detail}</p>
                          <p className="text-[10px] text-ink-3">{ago(e.at)}</p>
                        </div>
                        <span className="font-mono">{birr(e.amount)}</span>
                      </div>
                    ))}
                  </div>
                )}
              </Card>
            ))
          )}
        </div>
      )}

      {tab === 'blocked' && (
        <Card>
          <CardHeader
            title="Payouts held by reconciliation"
            icon={<Lock className="size-4" />}
            subtitle="These are sellers waiting on an agent's cash, not administrative delay"
          />
          {data.blockedSettlements.length === 0 ? (
            <Empty icon={<CheckCircle2 className="size-5" />} title="Nothing blocked" message="Every settlement is clear to pay." />
          ) : (
            <div className="space-y-1.5">
              {data.blockedSettlements.map((s) => (
                <div key={s.id} className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-bad/30 bg-bad/5 p-2.5">
                  <div>
                    <p className="flex items-center gap-2 text-xs font-semibold">
                      <span className="font-mono text-[11px]">{s.code}</span>
                      <span>{s.sellerName}</span>
                    </p>
                    <p className="mt-0.5 text-[10px] text-bad">Held until the cash variance clears</p>
                  </div>
                  <span className="font-mono text-sm font-bold">{birr(s.netPayable)}</span>
                </div>
              ))}
            </div>
          )}
          <Notice tone="info" className="mt-3" title="Blocked is not lost">
            A blocked payout is visible to the seller, with the reason, rather than quietly delayed. Finance cannot
            approve around it — that refusal is enforced on the API, not just in this screen.
          </Notice>
        </Card>
      )}
    </div>
  );
}
