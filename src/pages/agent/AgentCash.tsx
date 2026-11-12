import { useState } from 'react';
import { AlertTriangle, Banknote, CheckCircle2, Landmark, Receipt, Scale, Send, ShieldCheck, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, birr, dateTime, num } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Field, Input, KeyValue, Notice, Progress, Select, Spinner, Stat, StatusBadge } from '../../components/ui.tsx';
import type { CodDeposit, DeliveryAgent, Id, Minor } from '../../../shared/types.ts';

type Cash = {
  agent: { name: string; cashHeld: Minor; floatLimit: Minor; overLimit: boolean };
  today: { routeId: Id | null; expected: Minor; collected: Minor; outstanding: Minor; feeEstimate: Minor; netEstimate: Minor };
  deposits: CodDeposit[];
  note: string;
};

type Perf = {
  agent: DeliveryAgent;
  performance: { stops: number; delivered: number; failed: number; successRate: number; onTimeRate: number; rating: number; cashHeld: Minor; floatLimit: Minor };
};

const METHODS = ['CBE Birr', 'Telebirr', 'Awash Bank', 'Dashen Bank'] as const;

export function AgentCash() {
  const { data, loading, error, reload } = useQuery<Cash>('/agent/cash');
  const { data: me } = useQuery<Perf>('/agent/me');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<(typeof METHODS)[number]>('CBE Birr');
  const [reference, setReference] = useState('');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function deposit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      const r = await api.post<{ message: string; deposit: CodDeposit; cashHeld: Minor }>('/agent/cash/deposit', {
        amount: amount ? Math.round(Number(amount) * 100) : undefined,
        method,
        reference: reference.trim() || undefined,
      });
      setMsg(r.message);
      setAmount('');
      setReference('');
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not record that deposit.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading cash position…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { agent, today, deposits } = data;
  const floatPct = (agent.cashHeld / Math.max(1, agent.floatLimit)) * 100;
  const unconfirmed = deposits.filter((d) => d.status !== 'confirmed');

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Cash</h1>
        <p className="mt-0.5 text-xs text-ink-3">Collecting cash is not the same as being paid. Sellers get paid when your deposit clears.</p>
      </div>

      {msg && <Notice tone="ok" onClose={() => setMsg(null)}>{msg}</Notice>}
      {err && <ErrorNote message={err} />}

      {unconfirmed.length > 0 && (
        <Notice tone="warn" title={`${unconfirmed.length} remittance${unconfirmed.length === 1 ? '' : 's'} not yet confirmed`}>
          {unconfirmed.filter((d) => d.status === 'short').length > 0 && 'A short deposit blocks the seller payout for that route until the balance clears. '}
          Seller money only moves to them after finance confirms the money actually reached the platform account.
        </Notice>
      )}

      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="Cash in hand" value={birr(agent.cashHeld)} sub={`limit ${birr(agent.floatLimit)}`} tone={agent.overLimit ? 'bad' : 'brand'} icon={<Wallet className="size-4" />} />
        <Stat label="Expected on route" value={birr(today.expected)} sub={`${birr(today.outstanding)} unremitted`} tone="gold" icon={<Banknote className="size-4" />} />
        <Stat label="Handling fee" value={birr(today.feeEstimate)} sub="On today's collection" tone="muted" />
        <Stat label="Net to sellers" value={birr(today.netEstimate)} sub="After fee, once cleared" tone="ok" />
      </div>

      <Card className={clsx(agent.overLimit && 'border-bad/40')}>
        <CardHeader title="Float position" subtitle="Policy caps how much cash you may carry between deposits" />
        <Progress value={floatPct} tone={agent.overLimit ? 'bad' : floatPct > 80 ? 'warn' : 'ok'} />
        <div className="mt-2.5">
          <KeyValue k="Held" v={<b className={clsx('font-display text-sm', agent.overLimit && 'text-bad')}>{birr(agent.cashHeld)}</b>} />
          <KeyValue k="Limit" v={birr(agent.floatLimit)} />
          <KeyValue k="Headroom" v={<b className={agent.floatLimit - agent.cashHeld > 0 ? 'text-ok' : 'text-bad'}>{birr(agent.floatLimit - agent.cashHeld)}</b>} />
        </div>
        {agent.overLimit && (
          <Notice tone="bad" title="Over the float limit" className="mt-3">
            Deposit now. Carrying excess cash delays every seller on your route.
          </Notice>
        )}
      </Card>

      <div className="grid gap-4 lg:grid-cols-[1fr_340px]">
        <Card>
          <CardHeader title="Remittance history" subtitle="Every deposit, with the variance finance will check" />
          {deposits.length === 0 ? (
            <Empty icon={<Receipt className="size-5" />} title="No deposits yet" message="Your first remittance appears here after a cash-on-delivery route." />
          ) : (
            <div className="space-y-2">
              {deposits.map((d) => (
                <div key={d.id} className={clsx('rounded-md border p-3', d.status === 'short' ? 'border-bad/40 bg-bad/5' : 'border-line')}>
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-[11px] font-bold">{d.reference}</span>
                      <StatusBadge status={d.status} />
                      <Badge tone="muted">{d.method}</Badge>
                    </p>
                    <p className="font-mono text-sm font-bold">{birr(d.received)}</p>
                  </div>
                  <div className="mt-2 grid grid-cols-2 gap-x-4 sm:grid-cols-4">
                    <KeyValue k="Expected" v={birr(d.expected)} />
                    <KeyValue k="Fee" v={`−${birr(d.fee)}`} />
                    <KeyValue k="Net" v={birr(d.net)} />
                    <KeyValue k="Variance" v={<b className={d.variance > 0 ? 'text-bad' : 'text-ok'}>{d.variance > 0 ? `−${birr(d.variance)}` : birr(0)}</b>} />
                  </div>
                  <p className="mt-1.5 text-[10px] text-ink-3">
                    Route {d.routeId} · {d.receivedAt ? `received ${ago(d.receivedAt)}` : `due ${dateTime(d.dueAt)}`}
                  </p>
                  {d.note && <p className="mt-1 text-[11px] font-semibold text-bad">{d.note}</p>}
                </div>
              ))}
            </div>
          )}
        </Card>

        <div className="space-y-4">
          <Card className="border-brand/30">
            <CardHeader title="Deposit cash" icon={<Landmark className="size-4" />} subtitle="Send to the platform account, then declare it here" />
            <form onSubmit={deposit} className="space-y-3">
              <Field label="Amount deposited (ETB)" hint={agent.cashHeld > 0 ? `Leave blank to declare everything you hold (${birr(agent.cashHeld)}).` : 'You currently hold no cash.'}>
                <Input
                  type="number"
                  step="0.01"
                  min="0"
                  max={agent.cashHeld / 100}
                  value={amount}
                  onChange={(e) => setAmount(e.target.value)}
                  placeholder={String(agent.cashHeld / 100)}
                  disabled={agent.cashHeld <= 0}
                />
              </Field>
              <Field label="Sent via">
                <Select value={method} onChange={(e) => setMethod(e.target.value as (typeof METHODS)[number])}>
                  {METHODS.map((m) => (
                    <option key={m}>{m}</option>
                  ))}
                </Select>
              </Field>
              <Field label="Transaction reference" hint="Finance matches this against the bank statement.">
                <Input value={reference} onChange={(e) => setReference(e.target.value)} placeholder="FT23…" className="font-mono" />
              </Field>
              <Button type="submit" variant="primary" block loading={busy} icon={<Send className="size-4" />} disabled={agent.cashHeld <= 0}>
                Record remittance
              </Button>
              {agent.cashHeld <= 0 && <p className="text-[10px] text-ink-3">You hold no cash, so there is nothing to remit.</p>}
            </form>
          </Card>

          <Card>
            <CardHeader title="Your standing" icon={<Scale className="size-4" />} />
            {me ? (
              <div className="grid grid-cols-2 gap-x-4">
                <KeyValue k="Rating" v={`${me.performance.rating}★`} />
                <KeyValue k="On-time" v={`${me.performance.onTimeRate}%`} />
                <KeyValue k="Delivered" v={num(me.performance.delivered)} />
                <KeyValue k="Failed" v={num(me.performance.failed)} />
                <KeyValue k="Success rate" v={`${me.performance.successRate}%`} />
                <KeyValue k="Delivered 30d" v={num(me.agent.delivered30d)} />
              </div>
            ) : (
              <Spinner label="Loading performance…" />
            )}
            <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
              Your success and on-time rates come from real delivery events and feed the Buy Box trust score sellers
              are ranked on. They cannot be self-reported.
            </p>
          </Card>

          <Card className="bg-surface-2/60">
            <CardHeader title="Why this is separate" icon={<ShieldCheck className="size-4" />} />
            <p className="text-[11px] leading-relaxed text-ink-2">{data.note}</p>
            <ul className="mt-2 space-y-1.5 text-[11px] text-ink-3">
              <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> Your cash position updates the moment you collect, even offline.</li>
              <li className="flex gap-1.5"><CheckCircle2 className="mt-0.5 size-3 shrink-0 text-ok" /> The platform never treats your declared cash as a seller payment.</li>
              <li className="flex gap-1.5"><AlertTriangle className="mt-0.5 size-3 shrink-0 text-warn" /> A short remittance blocks the seller payout until it clears.</li>
            </ul>
          </Card>
        </div>
      </div>
    </div>
  );
}
