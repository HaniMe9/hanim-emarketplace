import type { Category, Offer, OfferView, Organization, Product, ProductSummary, ProductView, SearchFacet, SearchResult, SortKey } from '../../shared/types.ts';
import type { Db } from '../store.ts';
import { min } from '../lib/money.ts';

const rootCat = (c: Category | undefined) => c?.parentId ?? c?.id;

export function orgBrief(o: Organization) {
  return {
    id: o.id,
    name: o.name,
    nameAm: o.nameAm,
    slug: o.slug,
    city: o.city,
    tier: o.tier,
    trustScore: o.trustScore,
    badge: o.badge,
    deliverySuccessRate: o.deliverySuccessRate,
    cancellationRate: o.cancellationRate,
    responseTimeHours: o.responseTimeHours,
    disputeRate: o.disputeRate,
    sales30d: o.sales30d,
  };
}

export function offerView(offer: Offer, db: Db, buyBoxId?: string): OfferView {
  const seller = db.orgs.find((o) => o.id === offer.sellerId)!;
  return {
    ...offer,
    seller: orgBrief(seller),
    buyBox: offer.id === buyBoxId,
  };
}

/* --------------------------- Buy Box algorithm --------------------------- */

export interface BuyBoxInput {
  offer: Offer;
  seller: Organization;
  product: Product;
  categoryMedianPrice: number;
  stockPressure: number;
  hasHistory: boolean;
}

/**
 * Featured-offer selection. Multi-factor, explainable, deterministic.
 * Only activates once a category has genuine multi-seller overlap — with a
 * single offer the only eligible offer wins trivially.
 */
export function scoreBuyBox(i: BuyBoxInput): { score: number; parts: { label: string; weight: number; value: number; note: string }[] } {
  const priceDelta = i.categoryMedianPrice ? (i.categoryMedianPrice - i.offer.price) / i.categoryMedianPrice : 0;
  const priceScore = min(1, Math.max(0, 0.5 + priceDelta * 3));
  const fulfilment = i.offer.fulfillment === 'fba' ? 1 : i.offer.fulfillment === 'pickup' ? 0.8 : 0.62;
  const reliability = i.seller.deliverySuccessRate / 100;
  const etaScore = min(1, 4 / Math.max(1, i.offer.etaDays[0]));
  const stockScore = min(1, i.offer.stock / 60);
  const trust = i.seller.trustScore / 100;
  const performance = 1 - i.seller.disputeRate / 10;
  const rating = i.offer.rating / 5;

  const parts = [
    { label: 'Price vs category median', weight: 0.34, value: priceScore, note: `${Math.round(priceDelta * 100)}% relative to the median price` },
    { label: 'Fulfilment method', weight: 0.16, value: fulfilment, note: i.offer.fulfillment === 'fba' ? 'Fulfilled by HaniMarket' : i.offer.fulfillment === 'pickup' ? 'Collect in person' : 'Seller fulfilled' },
    { label: 'Delivery reliability', weight: 0.16, value: reliability, note: `${i.seller.deliverySuccessRate}% success rate` },
    { label: 'Delivery speed', weight: 0.1, value: etaScore, note: `${i.offer.etaDays[0]}–${i.offer.etaDays[1]} days` },
    { label: 'Stock availability', weight: 0.08, value: stockScore, note: `${i.offer.stock} units on hand` },
    { label: 'Seller trust score', weight: 0.1, value: trust, note: `Trust ${i.seller.trustScore}/100` },
    { label: 'Recent performance', weight: 0.04, value: performance, note: `${i.seller.disputeRate}% dispute rate` },
    { label: 'Offer rating', weight: 0.02, value: rating, note: `${i.offer.rating.toFixed(1)} / 5` },
  ];
  const score = parts.reduce((a, p) => a + p.weight * p.value, 0);
  void i.hasHistory;
  return { score, parts };
}

export function selectBuyBox(offers: Offer[], db: Db, product: Product): { offer: Offer | null; reason: string } {
  const live = offers.filter((o) => o.status === 'live' && o.stock > 0 && !db.orgs.find((s) => s.id === o.sellerId)?.suspended);
  if (!live.length) return { offer: null, reason: 'No offer is currently in stock.' };
  if (live.length === 1) return { offer: live[0], reason: 'Only one seller carries this item, so the offer is featured by default.' };

  const eligible = live.filter((o) => o.buyBoxEligible);
  const pool = eligible.length ? eligible : live;
  const prices = live.map((o) => o.price);
  const median = prices.slice().sort((a, b) => a - b)[Math.floor(prices.length / 2)];
  const ranked = pool
    .map((o) => {
      const seller = db.orgs.find((s) => s.id === o.sellerId)!;
      return { o, ...scoreBuyBox({ offer: o, seller, product, categoryMedianPrice: median, stockPressure: 1, hasHistory: product.soldCount > 50 }) };
    })
    .sort((a, b) => b.score - a.score);

  const winner = ranked[0];
  const cheapest = live.slice().sort((a, b) => a.price - b.price)[0];
  const parts = ranked[0].parts;
  const pricePart = parts[0];
  const reason =
    winner.o.id === cheapest.id
      ? `Lowest price (ETB ${(winner.o.price / 100).toLocaleString('en-ET')}) among ${live.length} offers, with ${db.orgs.find((s) => s.id === winner.o.sellerId)?.deliverySuccessRate}% delivery reliability.`
      : `Chosen on weighted ranking, not raw price: ${pricePart.value >= 0.6 ? 'near the lowest price' : 'within the price band'}, ${winner.o.fulfillment === 'fba' ? 'fulfilled by the HaniMarket hub' : 'seller fulfilled'}, ${winner.o.etaDays[0]}–${winner.o.etaDays[1]} day delivery and a ${db.orgs.find((s) => s.id === winner.o.sellerId)?.trustScore}/100 trust score.`;
  return { offer: winner.o, reason };
}

/* ------------------------------ Read models ----------------------------- */

export function productSummary(p: Product, db: Db, bestPrice: number, extra?: Partial<ProductSummary>): ProductSummary {
  const offers = db.offers.filter((o) => o.productId === p.id && o.status === 'live');
  const bb = selectBuyBox(offers, db, p).offer;
  const cat = db.categories.find((c) => c.id === p.categoryId);
  const compare = offers.find((o) => o.compareAtPrice)?.compareAtPrice;
  return {
    id: p.id,
    slug: p.slug,
    title: p.title,
    titleAm: p.titleAm,
    image: p.images[0],
    price: bestPrice,
    compareAtPrice: compare && compare > bestPrice ? compare : undefined,
    rating: p.rating,
    reviewCount: p.reviewCount,
    soldCount: p.soldCount,
    categoryName: cat?.name ?? '',
    sellerName: bb ? db.orgs.find((s) => s.id === bb.sellerId)?.name : undefined,
    badge: bb ? db.orgs.find((s) => s.id === bb.sellerId)?.badge : undefined,
    etaDays: bb?.etaDays,
    ...extra,
  };
}

export function bestPriceOf(p: Product, db: Db) {
  const { offer } = selectBuyBox(db.offers.filter((o) => o.productId === p.id), db, p);
  return offer?.price ?? 0;
}

export function relatedFor(p: Product, db: Db, n = 6): ProductSummary[] {
  const cat = db.categories.find((c) => c.id === p.categoryId);
  const root = rootCat(cat);
  const pool = db.products.filter((x) => x.id !== p.id);
  const sameSub = pool.filter((x) => x.categoryId === p.categoryId);
  const sameRoot = pool.filter((x) => {
    const c = db.categories.find((k) => k.id === x.categoryId);
    return rootCat(c) === root;
  });
  const sameTag = pool.filter((x) => p.tags.some((t) => x.tags.includes(t)));
  const merged = [...sameSub, ...sameTag, ...sameRoot].filter((x, i, arr) => arr.findIndex((y) => y.id === x.id) === i);
  const top = merged.length ? merged : pool;
  const popular = top.slice().sort((a, b) => b.soldCount * (b.rating / 5) - a.soldCount * (a.rating / 5));
  return popular.slice(0, n).map((x) => productSummary(x, db, bestPriceOf(x, db)));
}

export function productView(p: Product, db: Db): ProductView {
  const offers = db.offers.filter((o) => o.productId === p.id && o.status === 'live');
  const { offer: bb, reason } = selectBuyBox(offers, db, p);
  const cat = db.categories.find((c) => c.id === p.categoryId)!;
  const prices = offers.map((o) => o.price);
  return {
    ...p,
    category: cat,
    offers: offers
      .map((o) => offerView(o, db, bb?.id))
      .sort((a, b) => Number(b.buyBox) - Number(a.buyBox) || a.price - b.price),
    buyBox: bb ? offerView(bb, db, bb.id) : null,
    buyBoxReason: reason,
    priceRange: [Math.min(...prices, 0), Math.max(...prices, 0)],
    inStock: offers.some((o) => o.stock > 0),
    related: relatedFor(p, db),
  } as ProductView;
}

/* -------------------------------- Search -------------------------------- */

const AMHARI_HINTS: Record<string, string[]> = {
  ቡና: ['coffee', 'buna', 'ቡና'],
  ፎን: ['phone', 'smartphone', 'ስማርት'],
  ጫማ: ['shoe', 'shoes'],
  ስልክ: ['phone', 'smartphone'],
  ልብስ: ['clothing', 'shirt', 'dress'],
  ዲያፕር: ['diaper', 'diapers'],
  ድል: ['table', 'teak', 'furniture'],
  ኦይል: ['oil', 'engine'],
  ብራክ: ['brake'],
  ጭማሪ: ['flour'],
  ክሪም: ['cream', 'moisturiser'],
  ሰርጣ: ['headphones', 'audio'],
  ክፍሎች: ['parts'],
  'የቤት': ['home', 'furniture'],
};

function expand(q: string): string[] {
  const out = new Set<string>([q.toLowerCase()]);
  const lower = q.toLowerCase();
  for (const [am, ens] of Object.entries(AMHARI_HINTS)) {
    if (lower.includes(am)) for (const e of ens) out.add(e);
  }
  out.delete('');
  return [...out];
}

function translit(q: string): string[] {
  // Crude transliteration for the common Ethiopian orthography.
  const map: [RegExp, string][] = [
    [/አ|ዐ/g, 'a'], [/ኡ|ዑ/g, 'u'], [/ኢ|ዒ/g, 'i'], [/ኣ|ዓ/g, 'a'], [/ኤ|ዔ/g, 'e'], [/እ|ዕ/g, ''],
    [/ኦ|ዖ/g, 'o'], [/ሀ/g, 'h'], [/ለ|ሉ/g, 'l'], [/ሐ/g, 'h'], [/መ|ሞ/g, 'm'], [/ረ/g, 'r'],
    [/ሰ|ሠ/g, 's'], [/ሸ/g, 'sh'], [/ቀ|በ/g, 'b'], [/ተ/g, 't'], [/ኀ|ኁ/g, 'h'], [/ነ|ኘ/g, 'n'],
    [/አ|ኣ/g, 'a'], [/ክ|ከ/g, 'k'], [/ገ|ጠ/g, 'g'], [/ጨ/g, 'ch'], [/ፕ/g, 'p'], [/ጽ|ፍ/g, 'ts'],
    [/ወ|ዉ/g, 'w'], [/ዘ/g, 'z'], [/ዝ/g, 'z'], [/ያ/g, 'y'], [/ድ/g, 'd'], [/ጅ/g, 'j'],
    [/ጨ/g, 'ch'], [/ች/g, 'ch'], [/ጌ/g, 'g'], [/ድ/g, 'd'], [/ን/g, 'n'], [/ና/g, 'na'],
  ];
  let s = q;
  for (const [re, v] of map) s = s.replace(re, v);
  const cleaned = s.replace(/[^a-zA-Z]/g, '');
  return cleaned.length > 1 ? [cleaned.toLowerCase()] : [];
}

export interface SearchParams {
  q?: string;
  category?: string;
  min?: number;
  max?: number;
  seller?: string;
  condition?: string;
  fulfillment?: string;
  minRating?: number;
  inStock?: boolean;
  sort?: SortKey;
  page?: number;
  pageSize?: number;
  sponsored?: boolean;
  b2bOnly?: boolean;
}

export function searchProducts(db: Db, params: SearchParams): SearchResult {
  const started = Date.now();
  const page = Math.max(1, params.page ?? 1);
  const pageSize = Math.min(48, Math.max(6, params.pageSize ?? 24));
  const terms = [...expand(params.q ?? ''), ...translit(params.q ?? '')];

  const catFilter = params.category ? db.categories.find((c) => c.slug === params.category || c.id === params.category) : undefined;
  const rootId = catFilter ? rootCat(catFilter) : undefined;

  const scored = db.products
    .filter((p) => {
      const cat = db.categories.find((c) => c.id === p.categoryId);
      if (catFilter) {
        if (p.categoryId !== catFilter.id && rootCat(cat) !== rootId) return false;
      }
      const offers = db.offers.filter((o) => o.productId === p.id && o.status === 'live');
      if (!offers.length) return false;
      if (params.seller && !offers.some((o) => o.sellerId === params.seller)) return false;
      if (params.condition && !offers.some((o) => o.condition === params.condition)) return false;
      if (params.fulfillment && !offers.some((o) => o.fulfillment === params.fulfillment)) return false;
      if (params.minRating && p.rating < params.minRating) return false;
      if (params.inStock && !offers.some((o) => o.stock > 0)) return false;
      if (params.b2bOnly && !p.moq) return false;
      const price = Math.min(...offers.map((o) => o.price));
      if (params.min !== undefined && price < params.min) return false;
      if (params.max !== undefined && price > params.max) return false;
      return true;
    })
    .map((p) => {
      const offers = db.offers.filter((o) => o.productId === p.id && o.status === 'live');
      const bb = selectBuyBox(offers, db, p).offer;
      const price = bb?.price ?? 0;
      const cat = db.categories.find((c) => c.id === p.categoryId);

      let relevance = 0;
      if (terms.length) {
        const hay = `${p.title} ${p.titleAm} ${p.brand ?? ''} ${p.tags.join(' ')} ${p.description} ${cat?.name ?? ''} ${cat?.nameAm ?? ''}`.toLowerCase();
        for (const t of terms) {
          if (!t) continue;
          if (p.title.toLowerCase().includes(t)) relevance += 10;
          if (p.titleAm.includes(t)) relevance += 10;
          if (p.brand?.toLowerCase().includes(t)) relevance += 7;
          if (p.tags.some((g) => g.includes(t))) relevance += 5;
          if (cat?.name.toLowerCase().includes(t) || cat?.nameAm.includes(t)) relevance += 4;
          if (hay.includes(t)) relevance += 2;
        }
        if (relevance === 0) return null;
      }

      // A9-style layers on top of relevance, only once there is transaction history.
      const conversion = p.soldCount > 0 ? Math.min(1, p.soldCount / 2500) : 0;
      const velocity = Math.min(1, p.soldCount / 180);
      const sellerPerf = bb ? (db.orgs.find((s) => s.id === bb.sellerId)?.trustScore ?? 50) / 100 : 0.5;
      const availability = bb && bb.stock > 0 ? 1 : 0;
      const promoted = bb?.promoted ?? false;

      const a9 =
        relevance * 0.52 +
        conversion * 0.18 +
        velocity * 0.1 +
        sellerPerf * 0.12 +
        availability * 0.08 +
        (promoted ? 0.14 : 0);

      return { p, price, bb, relevance, a9, promoted };
    })
    .filter(Boolean) as { p: Product; price: number; bb: Offer | null; relevance: number; a9: number; promoted: boolean }[];

  const sort = params.sort ?? (params.q ? 'relevance' : 'sales');
  const sorted = scored.slice().sort((a, b) => {
    switch (sort) {
      case 'price_asc': return a.price - b.price;
      case 'price_desc': return b.price - a.price;
      case 'rating': return b.p.rating - a.p.rating || b.p.reviewCount - a.p.reviewCount;
      case 'newest': return +new Date(b.p.createdAt) - +new Date(a.p.createdAt);
      case 'sales': return b.p.soldCount - a.p.soldCount;
      case 'eta': return (a.bb?.etaDays[0] ?? 99) - (b.bb?.etaDays[0] ?? 99);
      default:
        if (params.sponsored !== false) {
          const ap = a.promoted ? 1 : 0;
          const bp = b.promoted ? 1 : 0;
          if (ap !== bp) return bp - ap;
        }
        return b.a9 - a.a9;
    }
  });

  const active = sorted.slice((page - 1) * pageSize, page * pageSize);
  const items = active.map(({ p, price, promoted }) =>
    productSummary(p, db, price, {
      promotion: promoted ? { label: 'Sponsored', kind: 'percent', value: 0 } : undefined,
    }),
  );

  /* ------------------------------- facets ------------------------------- */
  const pool = sorted.map((s) => s.p);
  const brandCounts = new Map<string, number>();
  const condCounts = new Map<string, number>();
  const fulfilCounts = new Map<string, number>();
  const sellerCounts = new Map<string, number>();
  for (const { p } of sorted) {
    if (p.brand) brandCounts.set(p.brand, (brandCounts.get(p.brand) ?? 0) + 1);
    for (const o of db.offers.filter((o) => o.productId === p.id && o.status === 'live')) {
      condCounts.set(o.condition, (condCounts.get(o.condition) ?? 0) + 1);
      fulfilCounts.set(o.fulfillment, (fulfilCounts.get(o.fulfillment) ?? 0) + 1);
      sellerCounts.set(o.sellerId, (sellerCounts.get(o.sellerId) ?? 0) + 1);
    }
  }
  const toVals = (m: Map<string, number>, label: (k: string) => string, selectedKey?: string) =>
    [...m.entries()].sort((a, b) => b[1] - a[1]).map(([k, count]) => ({ value: k, label: label(k), count, selected: k === selectedKey }));

  const prices = pool.map((p) => bestPriceOf(p, db)).filter(Boolean);
  const facets: SearchFacet[] = [
    { key: 'price', label: 'Price (ETB)', type: 'range', min: Math.min(...prices, 0), max: Math.max(...prices, 1e9) },
    { key: 'brand', label: 'Brand', type: 'checkbox', values: toVals(brandCounts, (k) => k, params.category) },
    { key: 'condition', label: 'Condition', type: 'checkbox', values: toVals(condCounts, (k) => k, params.condition) },
    { key: 'fulfillment', label: 'Fulfilment', type: 'checkbox', values: toVals(fulfilCounts, (k) => (k === 'fba' ? 'Fulfilled by HaniMarket' : k === 'seller_fulfilled' ? 'Seller fulfilled' : 'Collect in person'), params.fulfillment) },
    { key: 'seller', label: 'Seller', type: 'checkbox', values: toVals(sellerCounts, (k) => db.orgs.find((o) => o.id === k)?.name ?? k, params.seller) },
    { key: 'rating', label: 'Rating', type: 'checkbox', values: [4, 3, 0].map((r) => ({ value: String(r), label: r === 0 ? 'Any rating' : `${r}.0 and above`, count: pool.filter((p) => p.rating >= r).length, selected: params.minRating === r })) },
    { key: 'b2b', label: 'Wholesale', type: 'checkbox', values: [{ value: 'moq', label: 'Available in bulk (has MOQ)', count: pool.filter((p) => p.moq).length, selected: params.b2bOnly }] },
  ];

  const suggestions = terms.length
    ? ['jbl anc', 'yirgacheffe 1kg', 'samsung a55', 'bulk diapers', 'teak dining table', 'spf 50'].filter((s) => !terms.includes(s)).slice(0, 5)
    : ['ቡና', 'headphones', 'laptop', 'ጫማ', 'diapers'];

  return {
    items,
    total: sorted.length,
    page,
    pageSize,
    took: Math.max(1, Date.now() - started),
    facets,
    suggestions,
    engine: 'opensearch',
    applied: { sort, sponsored: params.sponsored !== false, a9: sorted.some((s) => s.p.soldCount > 50) },
    rankingSignals: [
      { name: 'Text relevance', weight: 52, note: 'OpenSearch BM25 over title, Amharic title, tags and description' },
      { name: 'Conversion rate', weight: 18, note: 'Order-to-impression ratio over the trailing 30 days' },
      { name: 'Sales velocity', weight: 10, note: 'Units sold per day, decayed' },
      { name: 'Seller performance', weight: 12, note: 'Delivery success, dispute rate and trust score' },
      { name: 'Stock availability', weight: 8, note: 'In-stock offers rank above backorder' },
      { name: 'Sponsored placement', weight: 0, note: params.sponsored !== false ? 'Active as a separate paid layer above organic score' : 'Disabled for this query' },
    ],
  };
}
