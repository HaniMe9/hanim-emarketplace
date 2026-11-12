import { Router } from 'express';
import type { Request } from 'express';
import type { Db } from '../store.ts';
import { notFound, ownerOf, qStr, logActivity } from './helpers.ts';
import { rate, sum } from '../lib/money.ts';
import { fees } from '../data/finance.ts';
import type { DeliveryEvent, Minor, ProofOfDelivery } from '../../shared/types.ts';

type PodKind = ProofOfDelivery['kind'];

/**
 * Delivery agent app. Designed to be usable with no network: the agent reads
 * their whole day up front, captures proof of delivery and cash on the handset,
 * and everything syncs afterwards. Nothing here assumes connectivity.
 */
export function agentRouter(db: Db): Router {
  const r = Router();

  /**
   * An agent's day is their own. An admin may pass `?as=` to inspect another
   * agent's round; an agent cannot.
   */
  const agentFor = (req: Request) => {
    let userId = req.user?.id;
    if (req.user?.role === 'admin') {
      const explicit = qStr(req.query.as, '');
      const target = explicit ? db.users.find((u) => u.id === explicit) : undefined;
      if (target) userId = target.id;
    }
    return db.agents.find((a) => a.userId === userId) ?? db.agents[0]!;
  };

  const routesFor = (agentId: string) => db.agentRoutes.filter((x) => x.agentId === agentId);

  /**
   * The routes containing a given stop. Ownership is checked through the route
   * rather than assumed: a stop is only reachable from the round that carries
   * it, so this is the one place that decides whether a stop is the caller's.
   */
  const ownRouteForStop = (agentId: string, shipmentId: string) =>
    db.agentRoutes.find((x) => x.agentId === agentId && x.stops.some((s) => s.shipmentId === shipmentId));

  /* ------------------------------- Today -------------------------------- */

  r.get('/today', (req, res) => {
    const agent = agentFor(req);
    const routes = routesFor(agent.userId);
    const active = routes.find((x) => x.status !== 'completed') ?? routes[routes.length - 1];
    res.json({
      agent,
      route: active ?? null,
      routes,
      queue: {
        pending: db.syncQueue.filter((q) => q.agentId === agent.userId && q.status !== 'synced').length,
        failed: db.syncQueue.filter((q) => q.agentId === agent.userId && q.status === 'failed').length,
      },
      cash: {
        held: agent.cashHeld,
        floatLimit: agent.floatLimit,
        headroom: agent.floatLimit - agent.cashHeld,
        overLimit: agent.cashHeld >= agent.floatLimit,
        collectedToday: sum((active?.stops ?? []).filter((s) => s.status === 'delivered').map((s) => s.codAmount)),
        expectedToday: active?.stats.expected ?? 0,
      },
      nextDeposit: db.codDeposits.find((d) => d.agentId === agent.userId && d.status !== 'confirmed') ?? null,
    });
  });

  r.get('/routes', (req, res) => {
    const agent = agentFor(req);
    res.json({ items: routesFor(agent.userId) });
  });

  r.get('/routes/:id', (req, res) => {
    const agent = agentFor(req);
    const found = db.agentRoutes.find((x) => x.id === req.params.id);
    const route = ownerOf(req, res, found, found?.agentId, agent.userId, 'Route');
    if (!route) return;
    res.json({ route, timeline: db.deliveryEvents.filter((e) => e.agentId === route.agentId).slice(0, 60) });
  });

  /**
   * The stop detail an agent sees at the door. Scoped to their own round: this
   * payload carries the buyer's name, phone number and street address, so an
   * unscoped lookup would let any agent read any customer's delivery details.
   */
  r.get('/stops/:shipmentId', (req, res) => {
    const agent = agentFor(req);
    const route = ownRouteForStop(agent.userId, req.params.shipmentId);
    const stop = route?.stops.find((s) => s.shipmentId === req.params.shipmentId);
    if (!stop) return notFound(res, 'Stop');
    const shipment = db.shipments.find((s) => s.id === stop.shipmentId);
    const order = db.orders.find((o) => o.shipment?.id === stop.shipmentId);
    res.json({
      stop,
      shipment: shipment ?? null,
      order: order
        ? {
            id: order.id,
            code: order.code,
            buyerName: order.buyerName,
            lines: order.lines.map((l) => ({ title: l.title, titleAm: l.titleAm, qty: l.qty, image: l.image })),
            total: order.total,
            paymentMethod: order.paymentMethod,
            address: order.address,
          }
        : null,
      timeline: db.deliveryEvents.filter((e) => e.shipmentId === stop.shipmentId),
    });
  });

  /* ------------------------- Online / offline state ---------------------- */

  r.post('/connectivity', (req, res) => {
    const agent = agentFor(req);
    const online = Boolean((req.body as { online?: boolean }).online);
    const route = db.agentRoutes.find((x) => x.agentId === agent.userId && x.status !== 'completed');
    if (route) {
      route.online = online;
      route.offlineSince = online ? undefined : (route.offlineSince ?? new Date().toISOString());
    }
    res.json({ online, offlineSince: route?.offlineSince, queued: db.syncQueue.filter((q) => q.agentId === agent.userId && q.status !== 'synced').length });
  });

  /* ------------------------- Proof of delivery --------------------------- */

  r.post('/stops/:shipmentId/deliver', (req, res) => {
    const agent = agentFor(req);
    const route = ownRouteForStop(agent.userId, req.params.shipmentId);
    const stop = route?.stops.find((s) => s.shipmentId === req.params.shipmentId);
    if (!stop) return notFound(res, 'Stop');
    if (stop.status === 'delivered') {
      return res.status(409).json({ error: 'already_delivered', message: 'This stop was already completed.' });
    }

    const body = req.body as {
      podKind?: PodKind;
      recipientName?: string;
      otpCode?: string;
      cashTendered?: Minor;
      note?: string;
      offline?: boolean;
      geo?: { lat: number; lng: number };
    };
    const kind: PodKind = body.podKind ?? (body.otpCode ? 'otp' : 'photo');
    const now = new Date().toISOString();
    // Trust the handset's own flag when it sends one; otherwise infer from the route.
    const offline = body.offline ?? (route ? !route.online : false);

    const collected = stop.codAmount;
    const changeGiven = Math.max(0, (body.cashTendered ?? collected) - collected);

    const pod: ProofOfDelivery = {
      id: `pod_${stop.id}`,
      kind,
      capturedBy: agent.userId,
      capturedAt: now,
      recipientName: body.recipientName ?? stop.customer,
      photoUrl: kind === 'photo' ? `/api/media/pod_${stop.id}` : undefined,
      signatureUrl: kind === 'signature' ? `/api/media/sig_${stop.id}` : undefined,
      otpCode: body.otpCode,
      syncedFromOffline: offline,
      geo: body.geo,
    };

    stop.status = 'delivered';
    stop.attempts += 1;
    stop.note = body.note ?? stop.note;

    const shipment = db.shipments.find((s) => s.id === stop.shipmentId);
    if (shipment) {
      shipment.status = 'delivered';
      shipment.deliveredAt = now;
      shipment.pod = pod;
      shipment.cashCollected = (shipment.cashCollected ?? 0) + collected;
      shipment.events.push({ id: `se_${stop.id}`, status: 'delivered', at: now, actor: 'agent', note: body.note ?? 'Delivered', offlineCaptured: offline });
    }

    const order = db.orders.find((o) => o.shipment?.id === stop.shipmentId);
    if (order) {
      order.status = 'delivered';
      order.history.push({ status: 'delivered', at: now, actor: 'agent', note: `Proof of delivery: ${kind}` });
    }

    // The agent's cash position moves the moment cash is in hand, online or not.
    agent.cashHeld += collected;
    agent.podsToday += 1;
    agent.delivered30d += 1;

    if (route) {
      route.stats.delivered += 1;
      route.stats.collected += collected;
      if (offline) {
        route.pendingSyncCount += 1;
        db.syncQueue.push({
          id: `sq_${stop.id}`,
          agentId: agent.userId,
          kind: 'pod',
          refId: stop.shipmentId,
          label: `${stop.orderCode} — proof of delivery`,
          capturedAt: now,
          bytes: 240000,
          attempts: 0,
          status: 'queued',
        });
      }
    }

    db.deliveryEvents.unshift({
      id: `de_${stop.id}_pod`,
      shipmentId: stop.shipmentId,
      orderCode: stop.orderCode,
      agentId: agent.userId,
      agentName: agent.name,
      at: now,
      kind: 'pod_captured',
      status: 'delivered',
      detail: collected > 0 ? `Delivered. ETB ${(collected / 100).toLocaleString('en-ET')} collected in cash.` : 'Delivered. Prepaid order, no cash due.',
      podKind: kind,
      cash: collected || undefined,
      offlineCaptured: offline,
      syncedAt: offline ? undefined : now,
      geo: body.geo,
    } satisfies DeliveryEvent);

    logActivity(db, agent.name, 'delivery.pod_captured', 'shipment', stop.shipmentId, `${stop.orderCode} · ${kind}${offline ? ' (captured offline)' : ''}`);

    res.status(201).json({
      stop,
      pod,
      shipment: shipment ?? null,
      change: changeGiven,
      cashHeld: agent.cashHeld,
      floatLimit: agent.floatLimit,
      overFloat: agent.cashHeld >= agent.floatLimit,
      queuedForSync: offline,
      message: collected > 0
        ? `Collected ETB ${(collected / 100).toLocaleString('en-ET')}. Your float is now ETB ${(agent.cashHeld / 100).toLocaleString('en-ET')}.`
        : 'Delivered. No cash due on this order.',
    });
  });

  r.post('/stops/:shipmentId/fail', (req, res) => {
    const agent = agentFor(req);
    const route = ownRouteForStop(agent.userId, req.params.shipmentId);
    const stop = route?.stops.find((s) => s.shipmentId === req.params.shipmentId);
    if (!stop) return notFound(res, 'Stop');
    if (stop.status === 'delivered') return res.status(409).json({ error: 'already_delivered', message: 'This stop was already completed.' });

    const body = req.body as { reason?: string; offline?: boolean };
    const now = new Date().toISOString();
    stop.attempts += 1;
    stop.status = 'failed';
    stop.note = body.reason ?? stop.note;

    const shipment = db.shipments.find((s) => s.id === stop.shipmentId);
    if (shipment) {
      shipment.attempt = stop.attempts;
      shipment.failureReason = body.reason;
      shipment.events.push({ id: `se_${stop.id}_f`, status: 'failed', at: now, actor: 'agent', note: body.reason });
    }

    if (route) {
      route.stats.failed += 1;
      if (route.stats.delivered + route.stats.failed >= route.stats.total) route.status = 'completed';
    }

    db.deliveryEvents.unshift({
      id: `de_${stop.id}_fail`,
      shipmentId: stop.shipmentId,
      orderCode: stop.orderCode,
      agentId: agent.userId,
      agentName: agent.name,
      at: now,
      kind: 'status_change',
      status: 'failed',
      detail: `Attempt ${stop.attempts} failed. ${body.reason ?? 'No one available.'}`,
      offlineCaptured: false,
    } satisfies DeliveryEvent);

    res.json({ stop, willRedeliver: stop.attempts < 2, message: stop.attempts < 2 ? 'One more attempt will be scheduled.' : 'Two failed attempts — this returns to the hub and the buyer is notified.' });
  });

  /* ------------------------------ Offline -------------------------------- */

  r.get('/sync-queue', (req, res) => {
    const agent = agentFor(req);
    const items = db.syncQueue.filter((q) => q.agentId === agent.userId);
    res.json({
      items,
      pending: items.filter((q) => q.status !== 'synced').length,
      bytes: sum(items.filter((q) => q.status !== 'synced').map((q) => q.bytes)),
      route: db.agentRoutes.find((x) => x.agentId === agent.userId && x.status !== 'completed') ?? null,
    });
  });

  r.post('/sync', (req, res) => {
    const agent = agentFor(req);
    const items = db.syncQueue.filter((q) => q.agentId === agent.userId && q.status !== 'synced');
    const now = new Date().toISOString();
    const synced: string[] = [];
    const failed: { id: string; error: string }[] = [];

    for (const item of items) {
      if (item.status === 'failed') {
        // Retrying a previously failed item: succeed unless the agent is offline.
        const route = db.agentRoutes.find((x) => x.agentId === agent.userId && x.status !== 'completed');
        if (route && !route.online) {
          item.attempts += 1;
          failed.push({ id: item.id, error: 'Still out of network coverage.' });
          continue;
        }
      }
      item.status = 'synced';
      item.attempts += 1;
      synced.push(item.id);
      if (item.kind === 'pod') {
        const ev = db.deliveryEvents.find((e) => e.shipmentId === item.refId && e.kind === 'pod_captured');
        if (ev) {
          ev.syncedAt = now;
          ev.offlineCaptured = false;
        }
        const shipment = db.shipments.find((s) => s.id === item.refId);
        if (shipment?.pod) shipment.pod.syncedFromOffline = false;
      }
    }

    const route = db.agentRoutes.find((x) => x.agentId === agent.userId && x.status !== 'completed');
    if (route) route.pendingSyncCount = db.syncQueue.filter((q) => q.agentId === agent.userId && q.status !== 'synced').length;

    res.json({
      synced: synced.length,
      failed,
      remaining: db.syncQueue.filter((q) => q.agentId === agent.userId && q.status !== 'synced').length,
      message: failed.length
        ? `${synced.length} item(s) synced, ${failed.length} still waiting on network. Nothing was lost.`
        : `${synced.length} item(s) synced.`,
    });
  });

  /* --------------------------- Cash reconciliation ------------------------ */

  r.get('/cash', (req, res) => {
    const agent = agentFor(req);
    const deposits = db.codDeposits.filter((d) => d.agentId === agent.userId);
    const today = db.agentRoutes.find((x) => x.agentId === agent.userId && x.status !== 'completed');
    const expected = today?.stats.collected ?? 0;
    res.json({
      agent: { name: agent.name, cashHeld: agent.cashHeld, floatLimit: agent.floatLimit, overLimit: agent.cashHeld >= agent.floatLimit },
      today: {
        routeId: today?.id ?? null,
        expected,
        collected: expected,
        outstanding: Math.max(0, expected - agent.cashHeld),
        feeEstimate: rate(expected, fees.codFeeRate),
        netEstimate: expected - rate(expected, fees.codFeeRate),
      },
      deposits,
      note: 'Cash collected is only released to the seller after it reaches the platform account. Capture is not the same as payable.',
    });
  });

  r.post('/cash/deposit', (req, res) => {
    const agent = agentFor(req);
    const body = req.body as { amount?: Minor; method?: 'CBE Birr' | 'Telebirr' | 'Awash Bank' | 'Dashen Bank'; reference?: string };
    const route = db.agentRoutes.find((x) => x.agentId === agent.userId && x.status !== 'completed');
    const expected = route?.stats.collected ?? 0;
    const amount = body.amount ?? agent.cashHeld;
    const fee = rate(amount, fees.codFeeRate);
    const received = Math.min(amount, agent.cashHeld);
    const variance = expected - received;
    const now = new Date().toISOString();

    const deposit = {
      id: `dep_new_${agent.id}_${db.codDeposits.length + 1}`,
      agentId: agent.userId,
      agentName: agent.name,
      routeId: route?.id ?? 'rt_none',
      expected,
      received,
      fee,
      net: received - fee,
      method: body.method ?? ('CBE Birr' as const),
      reference: body.reference ?? `REM-${80000 + db.codDeposits.length * 7}`,
      dueAt: now,
      receivedAt: now,
      variance,
      status: (variance > 0 ? 'short' : 'confirmed') as 'short' | 'confirmed',
      note: variance > 0 ? `ETB ${(variance / 100).toFixed(2)} short of the route total. Payout stays blocked until it clears.` : undefined,
    };
    db.codDeposits.unshift(deposit);
    agent.cashHeld -= received;

    logActivity(db, agent.name, 'cod.deposit_submitted', 'deposit', deposit.id, `ETB ${(received / 100).toLocaleString('en-ET')} via ${deposit.method}`);

    res.status(201).json({
      deposit,
      cashHeld: agent.cashHeld,
      message: variance > 0
        ? `Deposit recorded, but it is ETB ${(variance / 100).toFixed(2)} short. The seller payout for this route stays blocked until the balance clears.`
        : `Deposit confirmed. ETB ${(deposit.net / 100).toLocaleString('en-ET')} after the handling fee.`,
    });
  });

  /* ------------------------------ Performance ---------------------------- */

  r.get('/me', (req, res) => {
    const agent = agentFor(req);
    const routes = routesFor(agent.userId);
    const allStops = routes.flatMap((x) => x.stops);
    const delivered = allStops.filter((s) => s.status === 'delivered').length;
    const failed = allStops.filter((s) => s.status === 'failed').length;
    res.json({
      agent,
      performance: {
        stops: allStops.length,
        delivered,
        failed,
        successRate: allStops.length ? Number(((delivered / allStops.length) * 100).toFixed(1)) : 0,
        onTimeRate: agent.onTimeRate,
        rating: agent.rating,
        cashHeld: agent.cashHeld,
        floatLimit: agent.floatLimit,
        podQuality: { photo: allStops.length, signature: 0, otp: delivered, none: 0 },
      },
      recentEvents: db.deliveryEvents.filter((e) => e.agentId === agent.userId).slice(0, 25),
      note: agent.onTimeRate < 90 ? 'Your on-time rate is below the 90% floor. That is visible to buyers on your delivered orders.' : undefined,
    });
  });

  return r;
}
