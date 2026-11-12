import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { ArrowLeft, Camera, CheckCircle2, ChevronRight, CloudOff, CreditCard, FileSignature, Hash, KeyRound, MapPin, Package, Phone, RotateCcw, Signature, XCircle } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { api, ApiError } from '../../lib/api.ts';
import { ago, birr, dateTime, timeOnly } from '../../lib/format.ts';
import { Badge, Button, Card, CardHeader, Empty, ErrorNote, Field, Input, KeyValue, Notice, Progress, Select, Spinner, Stat, StatusBadge, Tabs, Textarea } from '../../components/ui.tsx';
import type { Address, AgentRoute, DeliveryEvent, Id, Minor, ProofOfDelivery } from '../../../shared/types.ts';
import { StopRow } from './AgentToday.tsx';

type RouteData = { route: AgentRoute; timeline: DeliveryEvent[] };

type StopDetail = {
  stop: AgentRoute['stops'][number];
  shipment: { id: Id; status: string; attempt: number; pod?: ProofOfDelivery; failureReason?: string } | null;
  order: {
    id: Id;
    code: string;
    buyerName: string;
    lines: { title: string; titleAm: string; qty: number; image: string }[];
    total: Minor;
    paymentMethod: string;
    address: Address;
  } | null;
  timeline: DeliveryEvent[];
};

type PodKind = ProofOfDelivery['kind'];

export function AgentRoutes() {
  const [params, setParams] = useSearchParams();
  const stopId = params.get('stop');
  const [tab, setTab] = useState('list');
  const { data, loading, error, reload } = useQuery<{ items: AgentRoute[] }>('/agent/routes');

  if (stopId) return <StopDetailView id={stopId} onBack={() => setParams({})} onDone={reload} />;

  return (
    <div className="space-y-4">
      <div>
        <h1 className="font-display text-xl font-bold">Routes</h1>
        <p className="mt-0.5 text-xs text-ink-3">Every route, its stops and its cash position.</p>
      </div>

      <Tabs
        tabs={[
          { id: 'list', label: 'Routes' },
          { id: 'timeline', label: 'Activity' },
        ]}
        value={tab}
        onChange={setTab}
      />

      {loading ? (
        <Spinner label="Loading routes…" />
      ) : error ? (
        <ErrorNote message={error} onRetry={reload} />
      ) : tab === 'list' ? (
        (data?.items.length ?? 0) === 0 ? (
          <Empty icon={<Package className="size-5" />} title="No routes" message="The hub has not published a plan for you yet." />
        ) : (
          <div className="space-y-3">
            {data!.items.map((r) => {
              const pct = r.stats.total ? (r.stats.delivered / r.stats.total) * 100 : 0;
              return (
                <Card key={r.id}>
                  <CardHeader
                    title={`${r.zone} · ${dateTime(r.date)}`}
                    action={
                      <div className="flex items-center gap-1.5">
                        {!r.online && <Badge tone="warn" icon={<CloudOff className="size-3" />}>Offline</Badge>}
                        <StatusBadge status={r.status} />
                      </div>
                    }
                  />
                  <Progress value={pct} tone={r.status === 'completed' ? 'ok' : 'brand'} />
                  <div className="mt-2.5 grid grid-cols-4 gap-2 text-center">
                    <Stat label="Stops" value={String(r.stats.total)} />
                    <Stat label="Done" value={String(r.stats.delivered)} tone="ok" />
                    <Stat label="Failed" value={String(r.stats.failed)} tone={r.stats.failed > 0 ? 'bad' : 'muted'} />
                    <Stat label="Cash" value={birr(r.stats.collected)} tone="gold" />
                  </div>
                  <div className="mt-3 space-y-1.5 border-t border-line pt-3">
                    {r.stops.map((s) => (
                      <StopRow key={s.id} stop={s} />
                    ))}
                  </div>
                </Card>
              );
            })}
          </div>
        )
      ) : (
        <Timeline routes={data?.items ?? []} />
      )}
    </div>
  );
}

function Timeline({ routes }: { routes: AgentRoute[] }) {
  const active = routes[0];
  const { data, loading, error } = useQuery<RouteData>(active ? `/agent/routes/${active.id}` : null);
  if (!active) return <Empty title="No activity" message="Nothing recorded yet." />;
  if (loading) return <Spinner label="Loading activity…" />;
  if (error) return <ErrorNote message={error} />;

  const events = data?.timeline ?? [];
  return (
    <Card>
      <CardHeader title="Delivery activity" subtitle="Newest first, including anything captured offline" />
      {events.length === 0 ? (
        <Empty title="Nothing yet" message="Events appear as you deliver." />
      ) : (
        <div className="space-y-1.5">
          {events.map((e) => (
            <div key={e.id} className="flex items-start gap-2.5 rounded-md border border-line p-2.5">
              <span className="mt-0.5 shrink-0">
                {e.kind === 'pod_captured' ? (
                  <CheckCircle2 className="size-4 text-ok" />
                ) : e.kind === 'cash_collected' ? (
                  <CreditCard className="size-4 text-gold" />
                ) : e.status === 'failed' ? (
                  <XCircle className="size-4 text-bad" />
                ) : (
                  <ChevronRight className="size-4 text-ink-3" />
                )}
              </span>
              <div className="min-w-0 flex-1">
                <p className="flex flex-wrap items-center gap-1.5 text-[11px]">
                  <span className="font-mono font-semibold">{e.orderCode}</span>
                  <StatusBadge status={e.status} />
                  {e.podKind && <Badge tone="muted">POD: {e.podKind}</Badge>}
                  {e.offlineCaptured && <Badge tone="warn">captured offline</Badge>}
                  {e.syncedAt ? <Badge tone="ok">synced</Badge> : <Badge tone="muted">unsynced</Badge>}
                  <span className="ml-auto text-ink-3">{ago(e.at)}</span>
                </p>
                <p className="mt-0.5 text-[11px] text-ink-2">{e.detail}</p>
                {e.cash ? <p className="mt-0.5 font-mono text-[10px] text-gold">{birr(e.cash)} collected</p> : null}
              </div>
            </div>
          ))}
        </div>
      )}
    </Card>
  );
}

function StopDetailView({ id, onBack, onDone }: { id: Id; onBack: () => void; onDone: () => void }) {
  const { data, loading, error, reload } = useQuery<StopDetail>(`/agent/stops/${id}`);
  const [podKind, setPodKind] = useState<PodKind>('photo');
  const [recipient, setRecipient] = useState('');
  const [otp, setOtp] = useState('');
  const [tendered, setTendered] = useState('');
  const [note, setNote] = useState('');
  const [failReason, setFailReason] = useState('');
  const [mode, setMode] = useState<'deliver' | 'fail'>('deliver');
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!data) return;
    setBusy(true);
    setErr(null);
    setMsg(null);
    try {
      if (mode === 'deliver') {
        const r = await api.post<{ message: string; change: Minor; queuedForSync: boolean; overFloat: boolean }>(
          `/agent/stops/${id}/deliver`,
          {
            podKind,
            recipientName: recipient.trim() || undefined,
            otpCode: otp.trim() || undefined,
            cashTendered: tendered ? Math.round(Number(tendered) * 100) : undefined,
            note: note.trim() || undefined,
          },
        );
        setMsg(
          `${r.message}${r.change > 0 ? ` Change given: ${birr(r.change)}.` : ''}${
            r.queuedForSync ? ' Queued for sync — it will upload when you have signal.' : ''
          }${r.overFloat ? ' You are over your float limit; deposit soon.' : ''}`,
        );
      } else {
        const r = await api.post<{ message: string }>(`/agent/stops/${id}/fail`, { reason: failReason.trim() || undefined });
        setMsg(r.message);
      }
      onDone();
      reload();
    } catch (e2) {
      setErr(e2 instanceof ApiError ? e2.message : 'Could not record that stop.');
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Spinner label="Loading stop…" />;
  if (error) return <ErrorNote message={error} onRetry={reload} />;
  if (!data) return null;

  const { stop, order, shipment } = data;
  const closed = stop.status === 'delivered';
  const due = stop.codAmount;

  return (
    <div className="space-y-4">
      <Button variant="ghost" size="sm" onClick={onBack} icon={<ArrowLeft className="size-3.5" />}>Back to route</Button>

      <Card>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <p className="flex items-center gap-2">
              <span className="font-mono text-xs font-bold">{stop.orderCode}</span>
              <StatusBadge status={stop.status} />
              {stop.attempts > 0 && <Badge tone="muted">attempt {stop.attempts}</Badge>}
            </p>
            <p className="mt-1.5 flex items-start gap-1.5 text-sm font-semibold">
              <MapPin className="mt-0.5 size-4 shrink-0 text-brand" />
              {stop.address}, {stop.city}
            </p>
            <a href={`tel:${stop.phone}`} className="mt-1 inline-flex items-center gap-1.5 text-xs text-brand hover:underline">
              <Phone className="size-3.5" /> {stop.customer} · {stop.phone}
            </a>
            <p className="mt-0.5 text-[11px] text-ink-3">
              Window {stop.window} · promised by {timeOnly(stop.promisedBy)} · zone {stop.zone}
            </p>
          </div>
          {due > 0 ? (
            <div className="rounded-md border border-gold/30 bg-gold/5 p-2.5 text-right">
              <p className="text-[10px] text-ink-3">Collect in cash</p>
              <p className="font-display text-lg font-bold">{birr(due)}</p>
            </div>
          ) : (
            <div className="rounded-md border border-ok/30 bg-ok/5 p-2.5 text-right">
              <p className="text-[10px] text-ink-3">Payment</p>
              <p className="text-sm font-bold text-ok">Prepaid</p>
            </div>
          )}
        </div>
        {stop.note && <Notice tone="warn" className="mt-3" title="Note from the hub">{stop.note}</Notice>}
        {shipment?.failureReason && !closed && (
          <Notice tone="bad" className="mt-3" title="Previous attempt failed">{shipment.failureReason}</Notice>
        )}
      </Card>

      {order && (
        <Card>
          <CardHeader title={`${order.lines.length} parcel${order.lines.length === 1 ? '' : 's'}`} icon={<Package className="size-4" />} />
          <div className="space-y-1.5">
            {order.lines.map((l, i) => (
              <p key={i} className="flex items-center gap-2 text-[11px]">
                <img src={l.image} alt="" className="size-8 shrink-0 rounded border border-line object-cover" />
                <span className="min-w-0 flex-1">
                  {l.title}
                  {l.titleAm && <span className="block text-[10px] text-ink-3">{l.titleAm}</span>}
                </span>
                <span className="text-ink-3">×{l.qty}</span>
              </p>
            ))}
          </div>
          <div className="mt-3 border-t border-line pt-2.5">
            <KeyValue k="Order total" v={birr(order.total)} />
            <KeyValue k="Payment" v={order.paymentMethod === 'cod' ? 'Cash on delivery' : order.paymentMethod} />
          </div>
        </Card>
      )}

      {closed ? (
        <Notice tone="ok" title="Delivered">
          {shipment?.pod
            ? `Proof of delivery captured as ${shipment.pod.kind}${shipment.pod.recipientName ? ` for ${shipment.pod.recipientName}` : ''}${shipment.pod.syncedFromOffline ? ', synced from offline capture' : ''}.`
            : 'This stop is closed and cannot be delivered again.'}
        </Notice>
      ) : (
        <Card>
          <Tabs
            tabs={[
              { id: 'deliver', label: 'Complete delivery' },
              { id: 'fail', label: 'Could not deliver' },
            ]}
            value={mode}
            onChange={(v) => setMode(v as 'deliver' | 'fail')}
          />

          {msg && <Notice tone="ok" className="mt-3" onClose={() => setMsg(null)}>{msg}</Notice>}
          {err && <div className="mt-3"><ErrorNote message={err} /></div>}

          {mode === 'deliver' ? (
            <form onSubmit={submit} className="mt-3 space-y-3">
              <div>
                <p className="mb-1.5 text-[11px] font-semibold text-ink-2">Proof of delivery</p>
                <div className="grid gap-2 sm:grid-cols-3">
                  {([
                    { id: 'photo', label: 'Photo', icon: <Camera className="size-4" /> },
                    { id: 'signature', label: 'Signature', icon: <Signature className="size-4" /> },
                    { id: 'otp', label: 'Buyer OTP', icon: <Hash className="size-4" /> },
                  ] as const).map((k) => (
                    <button
                      key={k.id}
                      type="button"
                      onClick={() => setPodKind(k.id)}
                      className={clsx(
                        'flex flex-col items-center gap-1 rounded-md border p-3 text-[11px] font-semibold transition',
                        podKind === k.id ? 'border-brand bg-brand/5 text-brand' : 'border-line hover:border-brand/40',
                      )}
                    >
                      {k.icon}
                      {k.label}
                    </button>
                  ))}
                </div>
              </div>

              {podKind === 'otp' && (
                <Field label="One-time code from the buyer" hint="Ask the buyer to read it from their order screen. Never guess or invent a code.">
                  <Input value={otp} onChange={(e) => setOtp(e.target.value)} inputMode="numeric" placeholder="6 digits" required={podKind === 'otp'} />
                </Field>
              )}

              <Field label="Received from" hint="Leave blank if you are handing it to the named customer.">
                <Input value={recipient} onChange={(e) => setRecipient(e.target.value)} placeholder={stop.customer} />
              </Field>

              {due > 0 && (
                <Field label={`Cash tendered (ETB)`} hint={`Due ${birr(due)}. Enter the amount in hand to compute change.`}>
                  <Input type="number" step="0.01" min="0" value={tendered} onChange={(e) => setTendered(e.target.value)} placeholder={String(due / 100)} />
                </Field>
              )}

              <Field label="Note">
                <Textarea rows={2} value={note} onChange={(e) => setNote(e.target.value)} placeholder="Left with concierge, phone off, gate code needed…" />
              </Field>

              <Button type="submit" variant="primary" block loading={busy} icon={<CheckCircle2 className="size-4" />}>
                Confirm delivery and collect
              </Button>
            </form>
          ) : (
            <form onSubmit={submit} className="mt-3 space-y-3">
              <Field label="Why did it fail?" required>
                <Select value={failReason} onChange={(e) => setFailReason(e.target.value)}>
                  <option value="">Choose a reason</option>
                  <option>No one available at the address</option>
                  <option>Phone unreachable</option>
                  <option>Address not found or wrong</option>
                  <option>Customer refused the parcel</option>
                  <option>Cash not available to pay</option>
                </Select>
              </Field>
              <Button type="submit" variant="danger" block loading={busy} icon={<XCircle className="size-4" />}>
                Record failed attempt
              </Button>
              <p className="text-[10px] leading-relaxed text-ink-3">
                After two failed attempts the parcel returns to the hub and the buyer is notified automatically. A
                failed attempt counts against your on-time rate, so record it honestly rather than guessing.
              </p>
            </form>
          )}
        </Card>
      )}

      {data.timeline.length > 0 && (
        <Card>
          <CardHeader title="Stop history" icon={<FileSignature className="size-4" />} />
          <div className="space-y-1.5">
            {data.timeline.map((e) => (
              <div key={e.id} className="flex items-start gap-2 rounded border border-line p-2 text-[11px]">
                <div className="min-w-0 flex-1">
                  <p className="flex items-center gap-1.5">
                    <StatusBadge status={e.status} />
                    {e.podKind && <Badge tone="muted">{e.podKind}</Badge>}
                    <span className="ml-auto text-ink-3">{ago(e.at)}</span>
                  </p>
                  <p className="mt-0.5 text-ink-2">{e.detail}</p>
                </div>
              </div>
            ))}
          </div>
        </Card>
      )}

      {shipment?.pod && (
        <Card>
          <CardHeader title="Captured proof" icon={<KeyRound className="size-4" />} />
          <div className="grid gap-2 sm:grid-cols-3">
            <KeyValue k="Method" v={shipment.pod.kind} />
            <KeyValue k="Received by" v={shipment.pod.recipientName ?? '—'} />
            <KeyValue k="Source" v={shipment.pod.syncedFromOffline ? 'Offline capture' : 'Live'} />
          </div>
          {shipment.pod.photoUrl && (
            <img src={shipment.pod.photoUrl} alt="Proof of delivery" className="mt-3 w-full max-w-xs rounded-md border border-line object-cover" />
          )}
        </Card>
      )}

      <Card className="bg-surface-2/60">
        <p className="flex items-start gap-1.5 text-[11px] leading-relaxed text-ink-3">
          <RotateCcw className="mt-0.5 size-3.5 shrink-0" />
          Deliveries work with no network. If the app closes, everything captured stays on the handset and syncs
          later — you never have to redo a delivery.
        </p>
      </Card>
    </div>
  );
}
