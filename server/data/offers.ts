import type { Offer, Product, Promotion, Review } from '../../shared/types.ts';
import { daysAgo, daysAhead } from '../lib/ids.ts';

const COND: Offer['condition'][] = ['new', 'new', 'new', 'like_new'];

/** Primary seller mapping by sub-category so a seller's store stays coherent. */
const OWNER: Record<string, string> = {
  cat_phones: 'org_selam',
  cat_laptops: 'org_selam',
  cat_audio: 'org_selam',
  cat_appliances: 'org_selam',
  cat_furniture: 'org_habesha_home',
  cat_kitchen: 'org_habesha_home',
  cat_bedding: 'org_habesha_home',
  cat_coffee: 'org_addis',
  cat_spices: 'org_addis',
  cat_menswear: 'org_kichen',
  cat_womenswear: 'org_kichen',
  cat_shoes: 'org_kichen',
  cat_skincare: 'org_glow',
  cat_haircare: 'org_glow',
  cat_bulk: 'org_bulkmart',
  cat_packaging: 'org_bulkmart',
  cat_diapers: 'org_kidsworld',
  cat_toys: 'org_kidsworld',
  cat_autoparts: 'org_motors',
  cat_care: 'org_motors',
};

const LOC: Record<string, string> = {
  org_selam: 'Addis Ababa · Bole',
  org_habesha_home: 'Addis Ababa · Akaki Kality',
  org_addis: 'Bule Hora · Sidama',
  org_kichen: 'Addis Ababa · Merkato',
  org_glow: 'Addis Ababa · Piazza',
  org_bulkmart: 'Addis Ababa · Lemi Kura',
  org_kidsworld: 'Addis Ababa · Kolfe Keranio',
  org_motors: 'Addis Ababa · Bole',
  org_fbab: 'HaniMarket Hub · Bole',
  org_medina: 'Mekelle · Piassa',
};

/** Extra competing sellers on selected products — this is what makes the Buy Box real. */
const RIVALS: Record<number, { org: string; delta: number; ff: Offer['fulfillment']; eta: [number, number]; note: string }[]> = {
  0: [{ org: 'org_fbab', delta: 30000, ff: 'fba', eta: [1, 2], note: 'Fulfilled by HaniMarket' }, { org: 'org_medina', delta: 120000, ff: 'seller_fulfilled', eta: [4, 7], note: 'Ships from Mekelle' }],
  1: [{ org: 'org_fbab', delta: 20000, ff: 'fba', eta: [1, 2], note: 'Fulfilled by HaniMarket' }, { org: 'org_selam', delta: 60000, ff: 'seller_fulfilled', eta: [2, 3], note: 'In stock, same-day dispatch' }],
  3: [{ org: 'org_fbab', delta: 15000, ff: 'fba', eta: [1, 2], note: 'Fulfilled by HaniMarket' }],
  4: [{ org: 'org_selam', delta: 40000, ff: 'seller_fulfilled', eta: [2, 4], note: 'Imported, 2-day dispatch' }],
  7: [{ org: 'org_fbab', delta: 25000, ff: 'fba', eta: [1, 3], note: 'Fulfilled by HaniMarket' }],
  12: [{ org: 'org_selam', delta: 9000, ff: 'seller_fulfilled', eta: [2, 3], note: 'Retail pack of 4' }, { org: 'org_fbab', delta: 12000, ff: 'fba', eta: [1, 2], note: 'Fulfilled by HaniMarket' }],
  19: [{ org: 'org_kichen', delta: 5000, ff: 'seller_fulfilled', eta: [3, 5], note: 'From our Piazza shelf' }],
  20: [{ org: 'org_fbab', delta: 1800, ff: 'fba', eta: [1, 2], note: 'Fulfilled by HaniMarket' }],
  25: [{ org: 'org_medina', delta: 4000, ff: 'seller_fulfilled', eta: [5, 9], note: 'Ships from Mekelle' }],
  26: [{ org: 'org_bulkmart', delta: 2500, ff: 'seller_fulfilled', eta: [3, 6], note: 'Pallet pricing available' }],
  28: [{ org: 'org_bulkmart', delta: 4000, ff: 'seller_fulfilled', eta: [3, 6], note: 'Full pallet only' }],
};

const STOCK_BASE: [number, number][] = [
  [4, 240], [10, 400], [2, 60], [40, 300], [12, 150], [6, 90], [8, 120], [14, 200], [5, 180],
  [3, 45], [30, 500], [15, 260], [20, 340], [50, 600], [25, 200], [60, 400], [35, 250], [18, 120],
  [9, 260], [45, 380], [22, 90], [16, 210], [70, 500], [28, 150],
];

function tierPrices(price: number, moq: number | null, i: number) {
  if (!moq) return undefined;
  return [
    { minQty: moq, price },
    { minQty: moq * 5, price: Math.round(price * 0.94) },
    { minQty: moq * 20, price: Math.round(price * 0.88) },
    { minQty: moq * 50, price: Math.round(price * 0.82) },
  ].filter((t) => i % 3 !== 2 || t.minQty === moq);
}

export function buildOffers(products: Product[]): Offer[] {
  const offers: Offer[] = [];
  let n = 0;
  products.forEach((p, i) => {
    const [lo, hi] = STOCK_BASE[i % STOCK_BASE.length];
    const seed = (i * 37) % 100;
    const basePrice = BASE_PRICE[i] ?? 0;
    const primaryOrg = OWNER[p.categoryId] ?? 'org_selam';
    const push = (org: string, price: number, ff: Offer['fulfillment'], eta: [number, number], stock: number, cond: Offer['condition']) => {
      n += 1;
      offers.push({
        id: `of_${String(n).padStart(4, '0')}`,
        productId: p.id,
        sellerId: org,
        price,
        compareAtPrice: price > 0 ? Math.round(price * (1.08 + (seed % 7) / 100)) : undefined,
        stock,
        condition: cond,
        fulfillment: ff,
        location: LOC[org] ?? 'Addis Ababa',
        etaDays: eta,
        warranty: p.attributes.Warranty,
        buyBoxEligible: org !== 'org_newbie' && org !== 'org_medina',
        promoted: seed % 5 === 0,
        tierPrices: tierPrices(price, p.moq, i),
        status: 'live',
        rating: 4 + ((seed % 10) / 10),
        createdAt: daysAgo(20 + ((i * 11) % 200)),
      });
    };

    push(primaryOrg, basePrice, 'seller_fulfilled', [2, 4], Math.round(lo + hi * 0.6), COND[i % COND.length]);

    for (const rv of RIVALS[i] ?? []) {
      push(rv.org, basePrice + rv.delta, rv.ff, rv.eta, Math.round(lo + (hi - lo) * 0.3), 'new');
    }
  });
  return offers;
}

/** Product base prices — kept next to the product seed order for a stable mapping. */
export const BASE_PRICE: number[] = [
  2840000, 1980000, 9650000, 385000, 1420000, 4780000, 2340000, 1120000, 1680000, 42000,
  385000, 28500, 48000, 62000, 95000, 68000, 385000, 12500, 16800, 8900,
  395000, 32000, 38500, 52000, 32000, 145000, 185000, 98000,
];

export const promotions: Promotion[] = [
  {
    id: 'promo_1', code: 'SELAM10', kind: 'percent', value: 10, minSubtotal: 500000, startsAt: daysAgo(6), endsAt: daysAhead(24),
    appliesToSellerIds: ['org_selam'], description: '10% off electronics from Selam Tech — end of month offer', active: true, usedCount: 412, budget: 4000000, perUserLimit: 1,
  },
  {
    id: 'promo_2', code: 'BUNA20', kind: 'percent', value: 20, minSubtotal: 100000, startsAt: daysAgo(3), endsAt: daysAhead(11),
    appliesToSellerIds: ['org_addis'], description: '20% off all coffee from Addis Coffee Estate', active: true, usedCount: 328, budget: 2000000, perUserLimit: 2,
  },
  {
    id: 'promo_3', code: 'FREESHIP50', kind: 'freeship', value: 5000, minSubtotal: 300000, startsAt: daysAgo(1), endsAt: daysAhead(9),
    appliesToSellerIds: 'all', description: 'Free delivery over ETB 3,000', active: true, usedCount: 1840, budget: 9000000, perUserLimit: 3,
  },
  {
    id: 'promo_4', code: 'WELCOME100', kind: 'fixed', value: 10000, minSubtotal: 80000, startsAt: daysAgo(30), endsAt: daysAhead(150),
    appliesToSellerIds: 'all', description: 'ETB 100 off for new buyers on their first order', active: true, usedCount: 5210, budget: 52100000, perUserLimit: 1,
  },
  {
    id: 'promo_5', code: 'BULK15', kind: 'percent', value: 15, minSubtotal: 2000000, startsAt: daysAgo(10), endsAt: daysAhead(50),
    appliesToSellerIds: ['org_bulkmart'], description: '15% off bulk orders over ETB 20,000', active: true, usedCount: 86, budget: 8000000, perUserLimit: 1, minDeliveryDays: 3,
  },
  {
    id: 'promo_6', code: 'SUMMER25', kind: 'percent', value: 25, minSubtotal: 200000, startsAt: daysAhead(14), endsAt: daysAhead(44),
    appliesToSellerIds: ['org_glow', 'org_kichen'], description: 'Summer sale — 25% off beauty and fashion', active: false, usedCount: 0, budget: 3000000, perUserLimit: 1,
  },
];

/* ------------------------------- Reviews -------------------------------- */

const REVIEW_BODIES: [number, string, string, string][] = [
  [5, 'Exactly as described', 'Arrived two days early and the packaging was solid. The seller answered my question on WhatsApp within the hour.', 'delivery'],
  [5, 'Worth every birr', 'I compared three shops in Addis before buying here. This was the best price and the warranty card came with it.', 'price'],
  [4, 'Good, minor nit', 'Product itself is great. Delivery was a day later than the estimate, but the agent called ahead so I was not waiting around.', 'delivery'],
  [5, 'Repeat customer', 'Third time ordering from this seller. Consistent quality every time, which is rarer than it should be.', 'repeat'],
  [4, 'Does the job', 'No complaints. Not going to pretend it is premium, but for the price it is more than fair.', 'value'],
  [5, 'Bought for my mother', 'She was looking for this for months. The Amharic description on the listing actually helped me choose the right one.', 'listing'],
  [3, 'Fine but slow', 'Item is fine. Took a while to ship and I had to chase the seller for an update, which cost me a star.', 'delivery'],
  [5, 'Genuine and sealed', 'Checked the seal and serial before opening. Registered the warranty on the spot with no questions.', 'trust'],
  [4, 'Nice finish', 'The finish is genuinely nicer than the photos suggest. Would order again.', 'quality'],
  [5, 'Best in the marketplace', 'Compared this against two other listings for the same item. Same seller, better price, faster delivery.', 'price'],
];

const REVIEW_AUTHORS = ['Abebe K.', 'Sara M.', 'Dawit A.', 'Hiwot G.', 'Marta T.', 'Yonas B.', 'Rahel H.', 'Feven G.', 'Kalkidan T.', 'Michael G.'];
const REVIEW_STATUS: Review['status'][] = ['published', 'published', 'published', 'published', 'published', 'published', 'pending', 'published', 'published', 'flagged', 'published', 'removed'];

export function buildReviews(products: Product[]): Review[] {
  const out: Review[] = [];
  let n = 0;
  products.forEach((p, pi) => {
    const count = 2 + ((pi * 3) % 4);
    for (let k = 0; k < count; k++) {
      n += 1;
      const [rating, title, body, tag] = REVIEW_BODIES[(pi * 5 + k * 3) % REVIEW_BODIES.length];
      const status = REVIEW_STATUS[(pi * 7 + k * 5) % REVIEW_STATUS.length];
      const flagged = status === 'flagged' || status === 'removed';
      out.push({
        id: `rv_${String(n).padStart(4, '0')}`,
        productId: p.id,
        orderId: `ord_${String(((pi * 11 + k * 3) % 40) + 1).padStart(4, '0')}`,
        authorName: REVIEW_AUTHORS[(pi + k * 3) % REVIEW_AUTHORS.length],
        rating,
        title,
        body,
        status,
        moderation: {
          flagged,
          reasons: flagged ? (status === 'removed' ? ['contains_vendor_contact'] : ['suspected_competitor']) : [],
          reviewedBy: flagged ? 'u_admin1' : undefined,
          at: flagged ? daysAgo(3 + k) : undefined,
        },
        verifiedPurchase: (pi + k) % 5 !== 0,
        helpfulCount: (pi * 7 + k * 13) % 46,
        createdAt: daysAgo(2 + ((pi * 5 + k * 11) % 120)),
        lang: (pi + k) % 7 === 0 ? 'am' : 'en',
        photos: k === 1 && (pi % 4 === 0) ? [`/api/media/rev${n}_0`] : [],
      });
      void tag;
    }
  });
  return out;
}
