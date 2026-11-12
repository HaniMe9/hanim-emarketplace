import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AlertTriangle, Banknote, Camera, CloudOff, CloudUpload, MapPin, Navigation, Package, RefreshCw, Route as RouteIcon, Signal, Smartphone, Wallet } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { birr, timeOnly, titleCase } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Grid, KeyValue, Notice, Progress, Spinner, Stat, StatusBadge } from '../../components/ui.tsx';
import type { AgentRoute, CodDeposit, DeliveryAgent, Minor } from '../../../shared/types.ts';

type Today = {
  agent: DeliveryAgent;
  route: AgentRoute | null;
  routes: AgentRoute[];
  queue: { pending: number; failed: number };
  cash: { held: Minor; floatLimit: Minor; headroom: Minor; overLimit: boolean; collectedToday: Minor; expectedToday: Minor };
  nextDeposit: CodDeposit | null;
};

type Stop = AgentRoute['stops'][number];

export function AgentToday() {
  const { data, loading, error, reload } = useQuery<Today>('/agent/today');
  const [online, setOnline] = useState<boolean | null>(null);
  const [syncMsg, setSyncMsg] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const route = data?.route ?? null;
  const isOnline = online ?? route?.online ?? true;

  async function toggle() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ online: boolean; queued: number }>('/agent/connectivity', { online: !isOnline });
      setOnline(r.online);
      setSyncMsg(
        r.online
          ? `Back online. ${r.queued} queued item${r.queued === 1 ? '' : 's'} waiting to sync.`
          : 'Offline. Deliveries keep working — proof of delivery is queued on the handset and synced when you have signal.',
      );
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Could not change connectivity state.');
    } finally {
      setBusy(false);
    }
  }

  async function sync() {
    setBusy(true);
    setErr(null);
    try {
      const r = await api.post<{ message: string; remaining: number }>('/agent/sync', {});
      setSyncMsg(r.message);
      reload();
    } catch (e) {
      setErr(e instanceof ApiError ? e.message : 'Sync failed. Your work is still stored on the handset.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading your day…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { agent, cash } = data;
  const stops = route?.stops ?? [];
  const next = stops.find((s) => s.status === 'pending' || s.status === 'arrived');
  const pct = route?.stats.total ? (route.stats.delivered / route.stats.total) * 100 : 0;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">{route ? titleCase(route.zone) : 'No route assigned'}</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {agent.name} · {titleCase(agent.vehicle)} · {agent.rating}★ · {agent.onTimeRate}% on time
          </p>
        </div>
        <Button
          variant={isOnline ? 'secondary' : 'gold'}
          loading={busy}
          onClick={() => void toggle()}
          icon={isOnline ? <Signal className="size-4" /> : <CloudOff className="size-4" />}
        >
          {isOnline ? 'Go offline' : 'Back online'}
        </Button>
      </div>

      <Notice tone={isOnline ? 'ok' : 'warn'} title={isOnline ? 'Online' : 'Working offline'}>
        {isOnline
          ? 'Proof of delivery uploads immediately. Keep the app open until a stop is confirmed.'
          : 'You can still deliver and collect cash. Everything is stored on the handset and synced the moment you have signal. Nothing is lost if the app closes.'}
      </Notice>

      {syncMsg && <Notice tone="info" onClose={() => setSyncMsg(null)}>{syncMsg}</Notice>}
      {err && <ErrorNote message={err} />}

      {data.queue.pending > 0 && (
        <Card className="flex flex-wrap items-center justify-between gap-3 border-gold/30">
          <div className="flex items-center gap-2.5">
            <CloudUpload className="size-5 text-gold" />
            <div>
              <p className="text-xs font-bold">{data.queue.pending} item{data.queue.pending === 1 ? '' : 's'} waiting to sync</p>
              <p className="text-[11px] text-ink-3">
                {data.queue.failed > 0 ? `${data.queue.failed} have already failed a retry. ` : ''}Delivery is not blocked by the queue.
              </p>
            </div>
          </div>
          <Button size="sm" variant="primary" loading={busy} onClick={() => void sync()} icon={<RefreshCw className="size-3.5" />}>Sync now</Button>
        </Card>
      )}

      {data.nextDeposit && (
        <Card className={clsx('flex flex-wrap items-center justify-between gap-3', data.nextDeposit.status === 'short' && 'border-bad/40')}>
          <div className="flex items-center gap-2.5">
            <Banknote className={clsx('size-5', data.nextDeposit.status === 'short' ? 'text-bad' : 'text-warn')} />
            <div>
              <p className="text-xs font-bold">
                Remittance {data.nextDeposit.status === 'short' ? 'short' : 'due'} — {birr(data.nextDeposit.variance)} outstanding
              </p>
              <p className="text-[11px] text-ink-3">
                {data.nextDeposit.note ?? `Deposit ${birr(data.nextDeposit.expected)} was due to the platform account.`}
              </p>
            </div>
          </div>
          <Link to="/agent/cash" className="text-[11px] font-semibold text-brand hover:underline">Open cash →</Link>
        </Card>
      )}

      {route ? (
        <>
          <Card>
            <CardHeader
              title={`Route progress · ${route.stats.delivered}/${route.stats.total}`}
              subtitle={route.stats.failed > 0 ? `${route.stats.failed} failed attempt${route.stats.failed === 1 ? '' : 's'}` : 'No failed attempts yet'}
              action={<StatusBadge status={route.status} />}
            />
            <Progress value={pct} tone={route.status === 'completed' ? 'ok' : 'brand'} />
            <Grid cols={3} className="mt-3">
              <Stat label="Delivered" value={String(route.stats.delivered)} tone="ok" />
              <Stat label="Remaining" value={String(route.stats.total - route.stats.delivered - route.stats.failed)} />
              <Stat label="Cash collected" value={birr(route.stats.collected)} tone="gold" icon={<Wallet className="size-4" />} />
            </Grid>
          </Card>

          {next && (
            <Card className="border-brand/40">
              <CardHeader title="Next stop" icon={<Navigation className="size-4 text-brand" />} action={<Badge tone="brand">#{next.sequence}</Badge>} />
              <div className="rounded-md border border-brand/25 bg-brand/5 p-3">
                <p className="flex items-start gap-1.5 text-sm font-semibold">
                  <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
                  {next.address}, {next.city}
                </p>
                <p className="mt-1 text-xs text-ink-2">{next.customer} · {next.phone}</p>
                <p className="mt-0.5 text-[11px] text-ink-3">
                  {next.parcelCount} parcel{next.parcelCount === 1 ? '' : 's'} · window {next.window} · due {timeOnly(next.promisedBy)}
                </p>
                {next.codAmount > 0 ? (
                  <p className="mt-2 inline-flex items-center gap-1.5 rounded bg-surface px-2 py-1 text-xs font-bold">
                    <Banknote className="size-3.5 text-gold" /> Collect {birr(next.codAmount)} in cash
                  </p>
                ) : (
                  <p className="mt-2 text-[11px] text-ok">Prepaid — no cash to collect</p>
                )}
                {next.note && <p className="mt-2 flex items-start gap-1.5 text-[11px] text-warn"><AlertTriangle className="mt-0.5 size-3 shrink-0" />{next.note}</p>}
                <Link
                  to={`/agent/routes?stop=${next.shipmentId}`}
                  className="mt-3 inline-flex h-9 items-center gap-1.5 rounded-md bg-brand px-3.5 text-xs font-semibold text-on-brand transition hover:bg-brand-600"
                >
                  <Camera className="size-4" /> Open stop
                </Link>
              </div>
            </Card>
          )}

          <div>
            <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
              <RouteIcon className="size-4" /> All stops
            </p>
            <div className="space-y-1.5">
              {stops.map((s) => (
                <StopRow key={s.id} stop={s} />
              ))}
            </div>
          </div>
        </>
      ) : (
        <Empty icon={<Package className="size-5" />} title="No active route" message="You have completed every route assigned to you. Check back when the hub publishes tomorrow's plan." />
      )}

      <Card>
        <CardHeader title="Cash and float" icon={<Wallet className="size-4" />} subtitle="Cash you are carrying right now" />
        <div className="space-y-0.5">
          <KeyValue k="Cash held" v={<b className={clsx('font-display text-sm', cash.overLimit && 'text-bad')}>{birr(cash.held)}</b>} />
          <KeyValue k="Float limit" v={birr(cash.floatLimit)} />
          <KeyValue k="Headroom" v={<b className={cash.headroom > 0 ? 'text-ok' : 'text-bad'}>{birr(cash.headroom)}</b>} />
        </div>
        <div className="mt-2">
          <Progress value={(cash.held / Math.max(1, cash.floatLimit)) * 100} tone={cash.overLimit ? 'bad' : cash.headroom < cash.floatLimit * 0.2 ? 'warn' : 'ok'} />
        </div>
        {cash.overLimit && (
          <Notice tone="bad" title="Over your float limit" className="mt-3">
            You are holding more cash than policy allows. Deposit before the next stops, or payouts to sellers will be
            held up.
          </Notice>
        )}
        <Link to="/agent/cash" className="mt-3 block text-[11px] font-semibold text-brand hover:underline">Deposit cash →</Link>
      </Card>

      <Card className="bg-surface-2/60">
        <CardHeader title="Handset" icon={<Smartphone className="size-4" />} />
        <div className="grid gap-2 sm:grid-cols-3">
          <KeyValue k="Last sync" v={route?.pendingSyncCount ? `${route.pendingSyncCount} pending` : 'Up to date'} />
          <KeyValue k="Offline capable" v={agent.offlineCapable ? 'Yes' : 'No'} />
          <KeyValue k="Pending on route" v={String(route?.pendingSyncCount ?? 0)} />
        </div>
        <p className="mt-2 text-[10px] text-ink-3">Queued bytes are small on purpose — {data.queue.pending > 0 ? 'sync runs in the background when signal returns.' : 'nothing waiting.'}</p>
      </Card>
    </div>
  );
}

export function StopRow({ stop }: { stop: Stop }) {
  return (
    <Link
      to={`/agent/routes?stop=${stop.shipmentId}`}
      className={clsx(
        'flex flex-wrap items-center justify-between gap-2 rounded-md border p-2.5 transition',
        stop.status === 'delivered' ? 'border-ok/25 bg-ok/5' : stop.status === 'failed' ? 'border-bad/25 bg-bad/5' : 'border-line hover:border-brand/40',
      )}
    >
      <div className="min-w-0">
        <p className="flex flex-wrap items-center gap-1.5 text-xs font-semibold">
          <span className="text-ink-3">#{stop.sequence}</span>
          <span className="font-mono text-[10px] text-ink-3">{stop.orderCode}</span>
          {stop.status === 'delivered' && <Badge tone="ok">Delivered</Badge>}
          {stop.status === 'failed' && <Badge tone="bad">Failed ×{stop.attempts}</Badge>}
          {stop.status === 'arrived' && <Badge tone="gold">At stop</Badge>}
        </p>
        <p className="mt-0.5 truncate text-[11px] text-ink-2">{stop.customer} · {stop.address}</p>
        {stop.note && stop.status === 'failed' && <p className="mt-0.5 text-[10px] text-bad">{stop.note}</p>}
      </div>
      <div className="flex items-center gap-2 text-right">
        {stop.codAmount > 0 && <span className="font-mono text-[11px] font-semibold">{birr(stop.codAmount)}</span>}
        <span className="text-[10px] text-ink-3">{timeOnly(stop.promisedBy)}</span>
      </div>
    </Link>
  );
}
