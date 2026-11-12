import type { AgentRoute, AgentStop, Order, Organization } from '../../shared/types.ts';
import { daysAgo, daysAhead } from '../lib/ids.ts';

const WINDOWS = ['09:00 – 11:00', '11:00 – 13:00', '13:00 – 15:00', '15:00 – 17:00', '17:00 – 19:00'];

export function buildRoutes(orders: Order[], orgs: Organization[]): AgentRoute[] {
  const orgName = new Map(orgs.map((o) => [o.id, o.name]));
  const today = orders.filter((o) => o.status === 'out_for_delivery' || o.status === 'confirmed' || o.status === 'packed');
  const inTransit = orders.filter((o) => o.status === 'shipped');
  const pick = [...today.slice(0, 14), ...inTransit.slice(0, 4)];

  const zones = [
    { name: 'Bole · Zone 1', agentId: 'u_agent1' },
    { name: 'Kirkos · Zone 2', agentId: 'u_agent2' },
    { name: 'Kirkos · Zone 3', agentId: 'u_agent1' },
    { name: 'Arada · Zone 4', agentId: 'u_agent2' },
  ];

  const routes: AgentRoute[] = [];
  zones.forEach((z, zi) => {
    const mine = pick.filter((_, i) => i % zones.length === zi);
    if (!mine.length) return;
    let n = 0;
    const stops: AgentStop[] = mine.map((o, i) => {
      n += 1;
      const cod = o.paymentMethod === 'cod' ? o.total : 0;
      const state: AgentStop['status'] = zi === 0 ? (i < 4 ? 'delivered' : i === 4 ? 'arrived' : 'pending') : i < 2 && zi === 1 ? 'delivered' : 'pending';
      return {
        id: `st_${zi}_${n}`,
        shipmentId: o.shipment?.id ?? `sh_missing_${o.id}`,
        orderCode: o.code,
        sequence: n,
        customer: o.address.recipient,
        phone: o.address.phone,
        address: `${o.address.house}, ${o.address.kebele} ቀበሌ, ${o.address.woreda}, ${o.address.subcity}`,
        city: o.address.city,
        zone: z.name,
        codAmount: cod,
        status: state,
        attempts: state === 'delivered' ? 1 : 0,
        window: WINDOWS[i % WINDOWS.length],
        note: o.address.landmark,
        parcelCount: o.lines.reduce((a, l) => a + l.qty, 0),
        productTitles: o.lines.map((l) => l.title),
        promisedBy: daysAhead(0),
      };
    });
    const collected = stops.filter((s) => s.status === 'delivered').reduce((a, s) => a + s.codAmount, 0);
    const expected = stops.reduce((a, s) => a + s.codAmount, 0);
    const delivered = stops.filter((s) => s.status === 'delivered').length;
    const failed = stops.filter((s) => s.status === 'failed').length;
    routes.push({
      id: `rt_${zi + 1}`,
      agentId: z.agentId,
      agentName: z.agentId === 'u_agent1' ? 'Kalkidan Tadesse' : 'Bereket Assefa',
      date: daysAgo(0),
      zone: z.name,
      status: zi === 0 ? 'in_progress' : 'planned',
      stops,
      stats: { total: stops.length, delivered, failed, collected, expected },
      online: zi !== 1,
      offlineSince: zi === 1 ? daysAgo(0) : undefined,
      pendingSyncCount: zi === 1 ? stops.filter((s) => s.status === 'delivered').length + 1 : 0,
    });
  });

  // A completed route from yesterday, so the agent app has history.
  const done = orders.filter((o) => o.status === 'delivered').slice(0, 11);
  if (done.length) {
    const stops: AgentStop[] = done.map((o, i) => ({
      id: `std_${i}`,
      shipmentId: o.shipment?.id ?? 'sh_unknown',
      orderCode: o.code,
      sequence: i + 1,
      customer: o.address.recipient,
      phone: o.address.phone,
      address: `${o.address.house}, ${o.address.kebele} ቀበሌ, ${o.address.woreda}, ${o.address.subcity}`,
      city: o.address.city,
      zone: 'Kirkos · Zone 2',
      codAmount: o.paymentMethod === 'cod' ? o.total : 0,
      status: i === 4 ? 'failed' : 'delivered',
      attempts: i === 4 ? 2 : 1,
      window: WINDOWS[i % WINDOWS.length],
      parcelCount: o.lines.reduce((a, l) => a + l.qty, 0),
      productTitles: o.lines.map((l) => l.title),
      promisedBy: daysAgo(1),
    }));
    const collected = stops.filter((s) => s.status === 'delivered').reduce((a, s) => a + s.codAmount, 0);
    routes.push({
      id: 'rt_prev',
      agentId: 'u_agent2',
      agentName: 'Bereket Assefa',
      date: daysAgo(1),
      zone: 'Kirkos · Zone 2',
      status: 'completed',
      stops,
      stats: { total: stops.length, delivered: stops.filter((s) => s.status === 'delivered').length, failed: 1, collected, expected: collected },
      online: true,
      pendingSyncCount: 0,
    });
  }

  void orgName;
  return routes;
}
