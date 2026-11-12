import type { Address, Offer, Order, OrderLine, Organization, Payment, Product, Shipment } from '../../shared/types.ts';
import { daysAgo, daysAhead } from '../lib/ids.ts';

const CITIES: [string, string, string][] = [
  ['Addis Ababa', 'Bole', 'Kirkos 05'],
  ['Addis Ababa', 'Kirkos', 'Kirkos 03'],
  ['Addis Ababa', 'Arada', 'Arada 01'],
  ['Addis Ababa', 'Lemi Kura', 'Lemi Kura 03'],
  ['Addis Ababa', 'Nole', 'Nole 02'],
  ['Adama', 'Adama', 'Adama 02'],
  ['Mekelle', 'Piassa', 'Piassa 01'],
  ['Hawassa', 'Hawassa', 'Hawassa 04'],
  ['Bahir Dar', 'Bahir Dar', 'Bahir Dar 02'],
  ['Dire Dawa', 'Dire Dawa', 'Dire Dawa 01'],
];

const NAMES = ['Abebe Kebede', 'Sara Moges', 'Dawit Alemu', 'Hiwot Girma', 'Marta Tesfaye', 'Yonas Bekele', 'Rahel Haile', 'Feven Getachew', 'Bereket Assefa', 'Michael Girma', 'Selam Worku', 'Kalkidan Tadesse'];
const PARTNERS: Shipment['partner'][] = ['hanimarket_courier', 'ethio_post', 'ekreta', 'dhl'];
const METHODS: Payment['method'][] = ['telebirr', 'cod', 'cbe_birr', 'cod', 'telebirr', 'awash', 'cod'];

export interface OrderBundle {
  orders: Order[];
  shipments: Shipment[];
  payments: Payment[];
}

const seq = (p: string, i: number, w = 4) => `${p}${String(i + 1).padStart(w, '0')}`;

export function buildCommerce(products: Product[], offers: Offer[], orgs: Organization[], addresses: Address[]): OrderBundle {
  const orders: Order[] = [];
  const shipments: Shipment[] = [];
  const payments: Payment[] = [];
  const liveOffers = offers.filter((o) => o.status === 'live');
  const prodById = new Map(products.map((p) => [p.id, p]));
  const orgById = new Map(orgs.map((o) => [o.id, o]));

  const STATUS_FLOW: { status: Order['status']; prob: number }[] = [
    { status: 'delivered', prob: 0.46 },
    { status: 'out_for_delivery', prob: 0.1 },
    { status: 'shipped', prob: 0.1 },
    { status: 'confirmed', prob: 0.06 },
    { status: 'packed', prob: 0.05 },
    { status: 'pending_payment', prob: 0.04 },
    { status: 'disputed', prob: 0.05 },
    { status: 'cancelled', prob: 0.06 },
    { status: 'refunded', prob: 0.04 },
    { status: 'out_for_delivery', prob: 0.04 },
  ];

  for (let i = 0; i < 44; i++) {
    const nLines = 1 + ((i * 7) % 3);
    const lines: OrderLine[] = [];
    const usedSellers = new Set<string>();
    for (let k = 0; k < nLines; k++) {
      const offer = liveOffers[(i * 13 + k * 29) % liveOffers.length];
      const product = prodById.get(offer.productId)!;
      // Volume buyers land on a tier, but the ladder length varies per offer, so
      // the quantity is derived from the deepest tier rather than a fixed index.
      const topTier = offer.tierPrices?.[offer.tierPrices.length - 1];
      const qty = topTier && (i + k) % 4 === 0 ? topTier.minQty : 1 + ((i + k) % 2);
      const tier = offer.tierPrices?.filter((t) => qty >= t.minQty).sort((a, b) => b.minQty - a.minQty)[0];
      const unitPrice = tier ? tier.price : offer.price;
      if (usedSellers.has(offer.sellerId) && nLines > 1) continue;
      usedSellers.add(offer.sellerId);
      lines.push({
        id: `ol_${i}_${k}`,
        productId: product.id,
        offerId: offer.id,
        sellerId: offer.sellerId,
        title: product.title,
        titleAm: product.titleAm,
        image: product.images[0],
        qty,
        unitPrice,
        lineTotal: unitPrice * qty,
        condition: offer.condition,
        fulfillment: offer.fulfillment,
        sellerName: orgById.get(offer.sellerId)?.name ?? 'Seller',
      });
    }
    if (!lines.length) continue;

    const buyerIdx = i % 4 === 0 ? 2 : i % 5;
    const buyerName = NAMES[buyerIdx];
    const addr = addresses[i % addresses.length];
    const method = METHODS[i % METHODS.length];
    const subtotal = lines.reduce((a, l) => a + l.lineTotal, 0);
    const deliveryFee = subtotal > 300000 ? 0 : 4500 + ((i * 700) % 3) * 1500;
    const tax = Math.round((subtotal + deliveryFee) * 0.15);
    const discount = method === 'cod' && i % 6 === 0 ? 1000 : 0;
    const total = subtotal + deliveryFee + tax - discount;

    // status distribution
    const pick = (i * 13) % 100;
    let acc = 0;
    let status: Order['status'] = 'delivered';
    for (const s of STATUS_FLOW) {
      acc += s.prob * 100;
      if (pick < acc) { status = s.status; break; }
    }
    if (method === 'cod' && status === 'pending_payment') status = 'confirmed';

    const placedDaysAgo = (i * 2 + 1) % 46;
    const placedAt = daysAgo(placedDaysAgo);
    const history: Order['status'][] = ['pending_payment', 'confirmed', 'packed', 'shipped', 'out_for_delivery', 'delivered', 'cancelled', 'refunded', 'disputed'];
    const order: Order = {
      id: seq('ord_', i),
      code: `HM-${String(48200 + i)}`,
      buyerId: buyerIdx === 2 ? 'u_b2b1' : buyerIdx === 3 ? 'u_b2b2' : buyerIdx === 0 ? 'u_buyer1' : 'u_buyer2',
      buyerName,
      status,
      lines,
      address: addr,
      subtotal,
      deliveryFee,
      tax,
      discount,
      total,
      paymentMethod: method,
      paymentState: status === 'pending_payment' ? 'created' : status === 'cancelled' ? 'created' : status === 'refunded' ? 'refunded' : method === 'cod' ? 'captured' : 'captured',
      paid: status === 'pending_payment' || status === 'cancelled' ? 0 : total,
      refunded: status === 'refunded' ? total : 0,
      channel: buyerIdx >= 2 ? 'b2b' : 'b2c',
      riskFlags: [],
      riskScore: 4 + ((i * 17) % 22),
      invoiceNo: `INV-${String(9100 + i)}`,
      fiscalReceiptNo: i % 3 === 0 ? `FR-${String(70000 + i * 3)}` : undefined,
      placedAt,
      etaFrom: daysAgo(placedDaysAgo - 2),
      etaTo: daysAhead(placedDaysAgo > 6 ? -(placedDaysAgo - 4) : 3),
      history: [],
      canCancel: status === 'pending_payment' || status === 'confirmed',
      canReview: status === 'delivered',
    };

    const idx = history.indexOf(status);
    const orderOf: { at: string; actor: Order['history'][number]['actor'] }[] = [
      { at: placedAt, actor: 'buyer' },
      { at: daysAgo(placedDaysAgo), actor: 'system' },
      { at: daysAgo(placedDaysAgo - 0.4), actor: 'seller' },
      { at: daysAgo(placedDaysAgo - 1), actor: 'seller' },
      { at: daysAgo(placedDaysAgo - 1.6), actor: 'agent' },
      { at: daysAgo(placedDaysAgo - 2.2), actor: 'agent' },
    ];
    const steps = status === 'cancelled' || status === 'refunded' || status === 'disputed' ? 1 + (i % 3) : idx + 1;
    for (let s = 0; s < steps; s++) {
      order.history.push({ status: history[s], at: orderOf[s].at, actor: orderOf[s].actor, note: s === 1 ? 'Payment confirmed' : undefined });
    }
    order.history.push({ status, at: daysAgo(placedDaysAgo - 2.2), actor: status === 'disputed' ? 'buyer' : 'agent', note: status === 'disputed' ? 'Buyer opened a dispute' : status === 'refunded' ? 'Refund issued to original method' : status === 'cancelled' ? 'Cancelled by seller' : undefined });

    const partner = PARTNERS[i % PARTNERS.length];
    const codAmount = method === 'cod' ? total : 0;
    const shipment: Shipment = {
      id: `sh_${String(i + 1).padStart(4, '0')}`,
      orderId: order.id,
      agentId: ['u_agent1', 'u_agent2'][i % 2],
      partner,
      zone: `${addr.subcity} Zone ${(i % 4) + 1}`,
      codAmount,
      status: status === 'delivered' ? 'delivered' : status === 'out_for_delivery' ? 'out_for_delivery' : status === 'shipped' ? 'picked_up' : status === 'cancelled' ? 'returned' : 'assigned',
      events: [],
      cashCollected: status === 'delivered' && codAmount ? codAmount : undefined,
      cashRemitted: status === 'delivered' && codAmount ? codAmount : undefined,
      expectedAt: daysAhead(2 - (placedDaysAgo % 3)),
      deliveredAt: status === 'delivered' ? daysAgo(placedDaysAgo - 2.2) : undefined,
      attempt: status === 'delivered' ? 1 : 1 + (i % 2),
      failureReason: status === 'cancelled' ? 'Buyer not reachable after 2 attempts' : undefined,
      codFee: codAmount ? Math.round(codAmount * 0.01) : 0,
    };
    const evFlow: [Shipment['status'], number, Shipment['events'][number]['actor'], boolean][] = [
      ['assigned', 0.3, 'system', false],
      ['picked_up', 1.1, 'seller', false],
      ['out_for_delivery', 2.0, 'agent', false],
      ['delivered', 2.2, 'agent', true],
    ];
    const sIdx = shipment.status === 'delivered' ? 3 : shipment.status === 'out_for_delivery' ? 2 : shipment.status === 'picked_up' ? 1 : 0;
    for (let s = 0; s <= sIdx; s++) {
      const [st, off, actor, offline] = evFlow[s];
      shipment.events.push({
        id: `se_${shipment.id}_${s}`,
        status: st,
        at: daysAgo(placedDaysAgo - off),
        actor,
        note: s === 1 ? 'Parcel scanned at hub' : s === 3 ? 'Delivered — recipient OTP verified' : undefined,
        offlineCaptured: offline && i % 3 === 0,
      });
    }
    if (status === 'delivered') {
      shipment.pod = {
        id: `pod_${shipment.id}`,
        kind: ['photo', 'otp', 'signature'][i % 3] as 'photo' | 'otp' | 'signature',
        capturedBy: 'agent',
        capturedAt: daysAgo(placedDaysAgo - 2.2),
        recipientName: buyerName.split(' ')[0],
        photoUrl: i % 3 === 0 ? `/api/media/pod_${i}` : undefined,
        otpCode: i % 3 === 1 ? String(1000 + (i % 9000)) : undefined,
        syncedFromOffline: i % 4 === 0,
        geo: { lat: 9.02 + (i % 10) * 0.004, lng: 38.74 + (i % 7) * 0.005 },
      };
    }
    order.shipment = shipment;
    orders.push(order);
    shipments.push(shipment);

    if (method !== 'cod') {
      const p: Payment = {
        id: `pay_${String(i + 1).padStart(4, '0')}`,
        orderId: order.id,
        method,
        amount: total,
        state: status === 'refunded' ? 'refunded' : status === 'cancelled' || status === 'pending_payment' ? 'created' : 'released',
        provider: method === 'telebirr' ? 'Telebirr' : method === 'cbe_birr' ? 'CBE Birr' : method === 'awash' ? 'Awash Bank' : 'HaniMarket',
        providerRef: `PSP-${String(700000 + i * 13)}`,
        createdAt: placedAt,
        capturedAt: status === 'pending_payment' || status === 'cancelled' ? undefined : daysAgo(placedDaysAgo),
        releasedAt: status === 'delivered' || status === 'refunded' ? daysAgo(placedDaysAgo - 3) : undefined,
        idempotencyKey: `idem_${order.id}_${total}`,
        fee: Math.round(total * 0.011),
      };
      order.paymentId = p.id;
      payments.push(p);
    }
  }

  return { orders, shipments, payments };
}

export const demoCities = CITIES;
