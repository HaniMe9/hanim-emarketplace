import type {
  AgentRoute,
  BuyBoxOverride,
  CodDeposit,
  DeliveryAgent,
  DeliveryEvent,
  FeatureFlags,
  Offer,
  PlatformSettings,
  SyncQueueItem,
} from '../../shared/types.ts';
import { daysAgo, daysAhead } from '../lib/ids.ts';
import { fees } from './finance.ts';

/**
 * Operational data that sits alongside the catalog and the ledger: the delivery
 * fleet, the offline sync queue, cash-on-delivery deposits, and the platform
 * configuration the admin console edits.
 */

export function buildAgents(): DeliveryAgent[] {
  return [
    {
      id: 'ag_1',
      userId: 'u_agent1',
      name: 'Kalkidan Tadesse',
      phone: '+251911445566',
      city: 'Addis Ababa',
      zones: ['Bole · Zone 1', 'Kirkos · Zone 3'],
      vehicle: 'motorbike',
      status: 'active',
      rating: 4.8,
      joinedAt: daysAgo(430),
      floatLimit: 3000000,
      cashHeld: 124000,
      delivered30d: 486,
      onTimeRate: 96.4,
      podsToday: 4,
      offlineCapable: true,
    },
    {
      id: 'ag_2',
      userId: 'u_agent2',
      name: 'Bereket Assefa',
      phone: '+251911223344',
      city: 'Addis Ababa',
      zones: ['Kirkos · Zone 2', 'Arada · Zone 4'],
      vehicle: 'bicycle',
      status: 'active',
      rating: 4.5,
      joinedAt: daysAgo(280),
      floatLimit: 2000000,
      cashHeld: 187600,
      delivered30d: 318,
      onTimeRate: 91.2,
      podsToday: 2,
      offlineCapable: true,
    },
    {
      id: 'ag_3',
      userId: 'u_agent3',
      name: 'Hiwot Alemu',
      phone: '+251911778899',
      city: 'Adama',
      zones: ['Adama · Zone 5'],
      vehicle: 'van',
      status: 'active',
      rating: 4.3,
      joinedAt: daysAgo(190),
      floatLimit: 5000000,
      cashHeld: 0,
      delivered30d: 141,
      onTimeRate: 88.7,
      podsToday: 0,
      offlineCapable: false,
    },
    {
      id: 'ag_4',
      userId: 'u_agent4',
      name: 'Meron Bekele',
      phone: '+251911332211',
      city: 'Addis Ababa',
      zones: ['Bole · Zone 1'],
      vehicle: 'on_foot',
      status: 'on_leave',
      rating: 4.1,
      joinedAt: daysAgo(95),
      floatLimit: 1000000,
      cashHeld: 0,
      delivered30d: 62,
      onTimeRate: 84.0,
      podsToday: 0,
      offlineCapable: true,
    },
  ];
}

/**
 * The agent timeline is written on the handset first and synced afterwards, so
 * events carry both the moment they happened and the moment they arrived.
 */
export function buildDeliveryEvents(routes: AgentRoute[]): DeliveryEvent[] {
  const out: DeliveryEvent[] = [];
  let n = 0;
  for (const route of routes) {
    for (const stop of route.stops) {
      n += 1;
      const agentId = route.agentId;
      const agentName = route.agentName;
      const base = { shipmentId: stop.shipmentId, orderCode: stop.orderCode, agentId, agentName };

      out.push({
        ...base,
        id: `de_${n}_a`,
        at: daysAgo(0.4),
        kind: 'status_change',
        status: 'out_for_delivery',
        detail: `Left the ${route.zone} depot for ${stop.window}`,
        offlineCaptured: false,
      });

      if (stop.status === 'delivered') {
        out.push({
          ...base,
          id: `de_${n}_b`,
          at: daysAgo(0.2),
          kind: 'status_change',
          status: 'out_for_delivery',
          detail: `Arrived at ${stop.customer}'s building`,
          offlineCaptured: false,
        });
        out.push({
          ...base,
          id: `de_${n}_c`,
          at: daysAgo(0.15),
          kind: 'pod_captured',
          status: 'delivered',
          detail: stop.codAmount > 0 ? `Delivered. ETB ${(stop.codAmount / 100).toLocaleString('en-ET')} collected in cash.` : 'Delivered. Prepaid order, no cash due.',
          podKind: stop.codAmount > 0 ? 'otp' : 'photo',
          cash: stop.codAmount || undefined,
          // The offline zone has no signal, so its proof of delivery is queued.
          offlineCaptured: !route.online,
          syncedAt: route.online ? daysAgo(0.1) : undefined,
          geo: { lat: 9.0192 + (n % 7) * 0.004, lng: 38.7525 + (n % 5) * 0.005 },
        });
      }

      if (stop.status === 'failed') {
        out.push({
          ...base,
          id: `de_${n}_d`,
          at: daysAgo(0.3),
          kind: 'status_change',
          status: 'failed',
          detail: `Attempt ${stop.attempts} failed. No one available and the phone was unreachable.`,
          offlineCaptured: false,
        });
      }
    }
  }
  return out.sort((a, b) => +new Date(b.at) - +new Date(a.at));
}

export function buildCodDeposits(routes: AgentRoute[], agents: DeliveryAgent[]): CodDeposit[] {
  const byAgent = new Map<string, AgentRoute[]>();
  for (const route of routes) {
    if (!byAgent.has(route.agentId)) byAgent.set(route.agentId, []);
    byAgent.get(route.agentId)!.push(route);
  }

  const out: CodDeposit[] = [];
  let n = 0;
  for (const [agentId, agentRoutes] of byAgent) {
    const agent = agents.find((a) => a.userId === agentId);
    for (const route of agentRoutes) {
      const expected = route.stats.collected;
      if (expected === 0) continue;
      n += 1;
      const fee = Math.round(expected * fees.codFeeRate);
      // Yesterday's runs settled. One deposit is deliberately short by ETB 1,240
      // because the partner courier has not remitted — that shortfall is what
      // blocks the seller's payout, and it must stay visible rather than smoothed.
      const short = agentId === 'u_agent2' && route.status === 'completed';
      const received = short ? expected - 124000 : expected;
      const status: CodDeposit['status'] = short ? 'short' : route.status === 'completed' ? 'confirmed' : 'submitted';
      out.push({
        id: `dep_${n}`,
        agentId,
        agentName: agent?.name ?? route.agentName,
        routeId: route.id,
        expected,
        received,
        fee,
        net: received - fee,
        method: 'CBE Birr',
        reference: `REM-${70000 + n * 7}`,
        dueAt: daysAgo(route.status === 'completed' ? 1 : 0),
        receivedAt: short ? undefined : daysAgo(route.status === 'completed' ? 1 : 0),
        variance: expected - received,
        status,
        note: short
          ? 'Cash collected on 4 stops has not been remitted. ETB 1,240.00 outstanding against the agent, so the payout for this route stays blocked.'
          : undefined,
      });
    }
  }
  return out;
}

export function buildSyncQueue(routes: AgentRoute[]): SyncQueueItem[] {
  const out: SyncQueueItem[] = [];
  let n = 0;
  for (const route of routes) {
    if (!route.offlineSince) continue;
    for (const stop of route.stops.filter((s) => s.status === 'delivered' || s.status === 'failed')) {
      n += 1;
      out.push({
        id: `sq_${n}`,
        agentId: route.agentId,
        kind: stop.status === 'delivered' ? 'pod' : 'status',
        refId: stop.shipmentId,
        label: `${stop.orderCode} — ${stop.status === 'delivered' ? 'proof of delivery' : 'failed attempt'}`,
        capturedAt: daysAgo(0.2),
        bytes: 240000 + n * 1800,
        attempts: n === 1 ? 0 : n === 2 ? 1 : 3,
        status: n === 1 ? 'queued' : n === 2 ? 'syncing' : 'failed',
        lastError: n === 3 ? 'No network route. The agent has been out of coverage since 07:40.' : undefined,
      });
    }
    n += 1;
    out.push({
      id: `sq_${n}`,
      agentId: route.agentId,
      kind: 'cash',
      refId: route.id,
      label: `${route.zone} — daily cash reconciliation`,
      capturedAt: daysAgo(0.1),
      bytes: 18000,
      attempts: 0,
      status: 'queued',
    });
  }
  return out;
}

export const settings: PlatformSettings = {
  vatRate: 0.15,
  withholdingRate: 0.02,
  codFeeBands: [
    { upto: 500000, fee: 0 },
    { upto: 1500000, fee: 5000 },
    { upto: 5000000, fee: 10000 },
    { upto: 9999999999, fee: 20000 },
  ],
  payoutSchedule: 'biweekly',
  settlementHoldDays: 14,
  disputeSlaHours: 72,
  vatRegistrationThreshold: 10000000,
  subscriptionPlans: [
    { id: 'starter', name: 'Starter', monthly: 0, features: ['Up to 20 listings', 'Standard 5% commission', 'Email support'] },
    { id: 'professional', name: 'Professional', monthly: 49900, features: ['Up to 300 listings', '3.5% commission', 'Priority support', 'Assisted listing'] },
    { id: 'enterprise', name: 'Enterprise', monthly: 249900, features: ['Unlimited listings', '2.5% commission', 'Dedicated account manager', 'B2B credit terms'] },
  ],
  deliveryFlat: fees.deliveryFlat,
  freeDeliveryThreshold: 300000,
  supportPhone: '+251 11 555 0100',
  updatedAt: daysAgo(0.5),
  updatedBy: 'u_admin1',
};

export const featureFlags: FeatureFlags = {
  assistedListing: true,
  pricingCopilot: true,
  demandForecast: true,
  b2bCredit: true,
  cod: true,
  promotions: true,
  referralProgram: false,
  shadowRecommendations: true,
  updatedAt: daysAgo(0.2),
};

/**
 * Manual Buy Box pins. An override is always labelled as one: the buyer-facing
 * ranking explanation has to say when a position was moved by a person rather
 * than earned on price and stock.
 */
export function buildBuyBoxOverrides(offers: Offer[]): BuyBoxOverride[] {
  const out: BuyBoxOverride[] = [];
  let n = 0;
  for (const offer of offers.filter((o) => o.buyBoxEligible).slice(0, 4)) {
    n += 1;
    const product = n % 2 === 0;
    out.push({
      id: `bbo_${n}`,
      productId: offer.productId,
      offerId: offer.id,
      reason: product
        ? 'New seller onboarding: pinned for 14 days so the first listings are not buried by incumbents. Shown to buyers as a promoted placement.'
        : 'Reported stock inconsistency against the incumbent offer. Pin held for 48 hours pending warehouse recount.',
      by: n % 2 === 0 ? 'u_admin1' : 'u_ops1',
      at: daysAgo(n + 1),
      expiresAt: daysAhead(product ? 13 : 1),
    });
  }
  return out;
}
