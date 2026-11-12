import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { Banknote, Camera, CheckCircle2, Clock, MapPin, Phone, Truck, User } from 'lucide-react';
import clsx from 'clsx';
import { useQuery } from '../../lib/useQuery.ts';
import { birr, dateOnly, dateTime, etbAmount, titleCase } from '../../lib/format.ts';
import { Button, Card, ErrorNote, KeyValue, Notice, Spinner, StatusBadge } from '../../components/ui.tsx';
import type { Order, ProofOfDelivery, User as UserType } from '../../../shared/types.ts';

interface TrackData {
  order: Order;
  milestones: { key: string; label: string; at?: string; done: boolean; detail?: string }[];
  agent: UserType | null;
  pod: ProofOfDelivery | null;
  cod: { amount: number; collected: number; changeGiven: number; exactChangeRequested: boolean; currency: string } | null;
  eta: { from: string; to: string };
}

export function TrackPage() {
  const { code } = useParams();
  const navigate = useNavigate();
  const [input, setInput] = useState(code ?? '');
  const { data, loading, error } = useQuery<TrackData>(code ? `/track/${code}` : null);

  if (!code) {
    return (
      <div className="mx-auto max-w-md space-y-4">
        <div>
          <h1 className="font-display text-xl font-bold">Track an order</h1>
          <p className="mt-1 text-xs text-ink-3">
            Enter the order number from your confirmation SMS. It looks like HM-48205.
          </p>
        </div>
        <Card>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              const v = input.trim().toUpperCase();
              if (v) navigate(`/track/${v}`);
            }}
            className="space-y-3"
          >
            <input
              value={input}
              onChange={(e) => setInput(e.target.value.toUpperCase())}
              placeholder="HM-48205"
              className="h-11 w-full rounded-md border border-line bg-surface px-3 font-mono text-base tracking-wider focus:border-brand focus:outline-none"
            />
            <Button type="submit" block variant="primary" icon={<Truck className="size-4" />}>Track</Button>
          </form>
        </Card>
        <Link to="/orders" className="block text-center text-xs text-ink-3 hover:text-brand">
          Or pick from your orders
        </Link>
      </div>
    );
  }

  if (loading) return <Spinner label="Finding that order…" />;
  if (error || !data) {
    return (
      <div className="space-y-4">
        <ErrorNote message={error ?? 'Order not found.'} />
        <Link to="/track">
          <Button variant="secondary">Try another number</Button>
        </Link>
      </div>
    );
  }

  const { order, milestones, agent, pod, cod, eta } = data;
  const delivered = order.status === 'delivered';

  return (
    <div className="mx-auto max-w-3xl space-y-5">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="font-display text-xl font-bold">Order {order.code}</h1>
          <p className="mt-0.5 text-xs text-ink-3">
            {delivered ? `Delivered ${dateOnly(order.shipment?.deliveredAt)}` : `Expected ${dateOnly(eta.from)} – ${dateOnly(eta.to)}`}
          </p>
        </div>
        <StatusBadge status={order.status} />
      </div>

      {/* timeline */}
      <Card>
        <ol className="relative space-y-4 border-l-2 border-line pl-6">
          {milestones.map((m) => (
            <li key={m.key} className="relative">
              <span
                className={clsx(
                  'absolute top-0.5 -left-[31px] flex size-5 items-center justify-center rounded-full border-2',
                  m.done ? 'border-brand bg-brand text-white' : 'border-line bg-surface text-ink-3',
                )}
              >
                {m.done ? <CheckCircle2 className="size-3" /> : <Clock className="size-2.5" />}
              </span>
              <p className={clsx('text-sm font-semibold', m.done ? 'text-ink' : 'text-ink-3')}>{m.label}</p>
              {m.detail && <p className="mt-0.5 text-[11px] leading-relaxed text-ink-2">{m.detail}</p>}
              {m.at && <p className="mt-0.5 text-[10px] text-ink-3">{dateTime(m.at)}</p>}
            </li>
          ))}
        </ol>
      </Card>

      {cod && !delivered && (
        <Card className="border-gold/30 bg-gold-soft/15">
          <p className="flex items-center gap-1.5 text-sm font-bold">
            <Banknote className="size-4 text-gold-ink" /> Cash due on delivery
          </p>
          <p className="mt-1 font-display text-2xl font-bold">{birr(cod.amount)}</p>
          <p className="mt-1 text-[11px] leading-relaxed text-ink-2">{etbAmount(cod.amount)}</p>
          <KeyValue k="Collected so far" v={birr(cod.collected)} />
          <KeyValue k="Change" v={cod.exactChangeRequested ? 'Please have exact change' : 'Change will be given'} />
          <p className="mt-2 text-[10px] leading-relaxed text-ink-3">
            Inspect the parcel before you hand over cash. If something is wrong, refuse the delivery and open a
            dispute — the money stays in escrow either way.
          </p>
        </Card>
      )}

      {agent && (
        <Card>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <User className="size-4 text-brand" /> Your delivery agent
          </p>
          <p className="text-sm font-semibold">{agent.name}</p>
          <p className="text-xs text-ink-3">{agent.phone}</p>
          <a href={`tel:${agent.phone}`} className="mt-2 inline-block">
            <Button size="sm" variant="secondary" icon={<Phone className="size-3.5" />}>Call the agent</Button>
          </a>
        </Card>
      )}

      {pod && (
        <Card>
          <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
            <Camera className="size-4 text-brand" /> Proof of delivery
          </p>
          <KeyValue k="Type" v={titleCase(pod.kind)} />
          {pod.recipientName && <KeyValue k="Received by" v={pod.recipientName} />}
          <KeyValue k="Captured" v={dateTime(pod.capturedAt)} />
          {pod.photoUrl && (
            <img src={pod.photoUrl} alt="Proof of delivery" className="mt-2 w-full max-w-xs rounded-md border border-line" />
          )}
          {pod.syncedFromOffline && (
            <Notice tone="info" className="mt-2">
              Captured offline by the agent and synced when the phone reconnected. The capture time is kept
              separate from the sync time, so a delayed sync does not look like a late delivery.
            </Notice>
          )}
        </Card>
      )}

      <Card>
        <p className="mb-2 flex items-center gap-1.5 text-sm font-bold">
          <MapPin className="size-4 text-brand" /> Delivering to
        </p>
        <p className="text-sm font-semibold">{order.address.recipient}</p>
        <p className="text-xs text-ink-2">
          {order.address.house}, {order.address.kebele}, {order.address.woreda}, {order.address.subcity}, {order.address.city}
        </p>
        {order.shipment && (
          <>
            <KeyValue k="Partner" v={titleCase(order.shipment.partner)} />
            <KeyValue k="Zone" v={order.shipment.zone} />
            <KeyValue k="Attempts" v={order.shipment.attempt} />
            {order.shipment.failureReason && (
              <Notice tone="bad" className="mt-2">Last attempt failed: {order.shipment.failureReason}</Notice>
            )}
          </>
        )}
      </Card>

      <div className="flex flex-wrap gap-2">
        <Link to={`/orders/${order.code}`}>
          <Button variant="secondary">Full order details</Button>
        </Link>
        {order.canCancel && (
          <Link to={`/orders/${order.code}`}>
            <Button variant="ghost" className="text-bad">Cancel order</Button>
          </Link>
        )}
        <Link to="/disputes">
          <Button variant="ghost">Report a problem</Button>
        </Link>
      </div>
    </div>
  );
}
