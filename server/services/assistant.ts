import type { Db } from '../store.ts';
import type { ProductSummary } from '../../shared/types.ts';
import { searchProducts } from '../services/catalog.ts';
import type { SortKey } from '../../shared/types.ts';

/**
 * Intent parsing and answer composition for the buyer assistant.
 *
 * The assistant is a grounded catalogue searcher, not a free-form generator: it
 * may only state prices, stock and delivery estimates that exist in the store,
 * because those are the numbers a buyer will be held to. Everything it says is
 * assembled from `searchProducts` output, so the text and the cards can never
 * disagree.
 */

export interface AssistantTurn {
  role: 'user' | 'assistant';
  content: string;
}

export interface AssistantResult {
  answer: string;
  products: ProductSummary[];
  citations: { productId: string; slug: string; title: string }[];
  /** Chips the client offers next; keeps the conversation moving without typing. */
  suggestions: string[];
  understood: { category?: string; maxMinor?: number; brand?: string; minRating?: number; bulk?: boolean };
  /** True when this turn had no new subject matter and leaned on earlier context. */
  followUp: boolean;
}

/* ------------------------------- intent ------------------------------- */

const CATEGORY_WORDS: Record<string, string[]> = {
  'cat_audio': ['headphone', 'headphones', 'earphone', 'earbuds', 'speaker', 'audio', 'soundbar', 'ሰርጣ', 'ክላ', 'ድምፅ'],
  'cat_coffee': ['coffee', 'buna', 'roaster', 'grinder', 'ቡና', 'ይርጋች', 'ጫጭ'],
  'cat_phones': ['phone', 'smartphone', 'tablet', 'mobile', 'charger', 'ስማርት', 'ፎን', 'ታብሌት'],
  'cat_laptops': ['laptop', 'notebook', 'macbook', 'computer', 'monitor', 'ላፕቶፕ', 'ኮምፒዩተር'],
  'cat_home': ['sofa', 'table', 'bed', 'mattress', 'chair', 'furniture', 'ድል', 'ቀርፎ', 'አውራሽ', 'ላምበር'],
  'cat_womens': ['dress', 'shirt', 'skirt', 'shoe', 'shoes', 'fashion', 'ልብስ', 'ጫማ', 'ሞዴን'],
  'cat_grocery': ['coffee', 'flour', 'oil', 'spice', 'grocery', 'ጭማሪ', 'ዘይት', 'ምግብ'],
  'cat_beauty': ['cream', 'moisturiser', 'lotion', 'perfume', 'beauty', 'ክሪም', 'ጥበቃ', 'ሐማን'],
  'cat_kids': ['diaper', 'baby', 'toy', 'kids', 'stroller', 'ዲያፕር', 'ልጆች', 'መጨመሻ'],
  'cat_auto': ['oil', 'brake', 'tyre', 'engine', 'auto', 'ኦይል', 'ብራክ', 'መንጪራ'],
};

const BRANDS = ['selam', 'addis', 'habesha', 'bulk', 'medina', 'kichen', 'glow', 'kids', 'lemlem', 'hanimarket'];

const CHEAPER = /(cheaper|less|lesser|lower|budget|cheapest|ዝቅተኛ|ብቻ|በታች|ርካሽ)/;
const MORE = /(more|others|other|another|else|best|top|options|ተጨማሪ|ሌላ|ሌሎች|ጥምጽ)/;
const RATED = /(rated|rating|reviews|best rated|top rated|\bstars?\b|የተመዘገበ|ግምገማ)/;

interface Intent {
  category?: string;
  brand?: string;
  maxMinor?: number;
  minRating?: number;
  bulk: boolean;
  sort?: SortKey;
  cheaper: boolean;
  wantsMore: boolean;
  wantsRating: boolean;
  /** Free-text subject, with the budget/brand words stripped out. */
  subject: string;
}

function parseIntent(message: string): Intent {
  const q = message.toLowerCase();

  // "under 5,000 birr", "below ETB 5000", "ከ2000 በታች"
  const budget =
    /(?:under|below|max|less than|up to|ከ|በታች)\s*([\d][\d,]{2,})\s*(?:birr|etb|ብር)?/.exec(q) ??
    /([\d][\d,]{3,})\s*(?:birr|etb|ብር)/.exec(q);
  const maxMinor = budget ? Math.round(Number(budget[1].replace(/,/g, '')) * 100) : undefined;

  const category = Object.entries(CATEGORY_WORDS).find(([, words]) => words.some((w) => q.includes(w)))?.[0];

  const brand = BRANDS.find((b) => new RegExp(`\\b${b}\\b`).test(q));

  const rating = /(?:rated|rating|reviews|stars?)\s*(?:above|over|at least|\+|ከ|በታች)?\s*([1-5](?:\.\d)?)/.exec(q);
  const minRating = rating ? Number(rating[1]) : undefined;

  const bulk = /\b(bulk|wholesale|moq|pallet|carton|ብርብ|ጭመብ)\b/.test(q);

  // Strip the modifiers so the leftover text is a usable search subject.
  let subject = message;
  if (budget) subject = subject.replace(budget[0], ' ');
  subject = subject
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\b(under|below|max|less than|up to|birr|etb|and|for|me|show|find|get|need|want|i|is|a|an|of|the|ከ|በታች|ብር|አስገኝ|ንጠልኝ|ፈልገለሁ|ያስፈልጋል)\b/gi, ' ')
    .replace(/\s+/g, ' ')
    .trim();

  return {
    category,
    brand,
    maxMinor,
    minRating,
    bulk,
    cheaper: CHEAPER.test(q),
    wantsMore: MORE.test(q),
    wantsRating: RATED.test(q),
    subject,
  };
}

/**
 * Merge this turn's intent with the conversation so far. A short follow-up like
 * "cheaper?" or "what about delivery to Addis?" carries no subject of its own;
 * without this it would silently reset the search to best-sellers.
 */
function resolveContext(intent: Intent, history: AssistantTurn[]): { category?: string; subject: string } {
  const priorUser = history.filter((h) => h.role === 'user').slice(-3).reverse();
  for (const turn of priorUser) {
    const before = parseIntent(turn.content);
    const category = intent.category ?? before.category;
    if (category) return { category, subject: intent.subject || before.subject };
  }
  return { category: intent.category, subject: intent.subject };
}

/* ------------------------------ answering ----------------------------- */

const etb = (minor: number) => (minor / 100).toLocaleString('en-ET');

function etaOf(s: ProductSummary, db: Db): string {
  if (s.etaDays) return `${s.etaDays[0]}-${s.etaDays[1]}`;
  const offer = db.offers.find((o) => o.productId === s.id && o.status === 'live');
  return offer ? `${offer.etaDays[0]}-${offer.etaDays[1]}` : '2-4';
}

function cityOf(s: ProductSummary, db: Db): string {
  const offer = db.offers
    .filter((o) => o.productId === s.id && o.status === 'live')
    .sort((a, b) => a.price - b.price)[0];
  return db.orgs.find((o) => o.id === offer?.sellerId)?.city ?? '';
}

export function askAssistant(
  db: Db,
  message: string,
  history: AssistantTurn[],
  am: boolean,
): AssistantResult {
  const intent = parseIntent(message);
  const ctx = resolveContext(intent, history);

  // "cheaper" sorts ascending within the current subject rather than starting over.
  const sort: SortKey | undefined = intent.cheaper
    ? 'price_asc'
    : intent.wantsRating
      ? 'rating'
      : intent.wantsMore
        ? 'sales'
        : undefined;

  const found = searchProducts(db, {
    q: ctx.subject,
    category: ctx.category,
    max: intent.maxMinor,
    minRating: intent.minRating,
    inStock: true,
    b2bOnly: intent.bulk,
    sort,
    pageSize: 8,
    sponsored: false,
  });

  const products = found.items.slice(0, 3);

  if (!products.length) {
    const hint = am
      ? 'የምርት ስም፣ የምድብ ስም ወይም የዋጋ ገደብ ይስጡ — ለምሳሌ «ከ2000 ብር በታች ስማርት»።'
      : 'Try a product name, a category, or a price ceiling — for example "headphones under ETB 5,000".';
    return {
      answer: am ? `ምንም የሚመለስ ምርት አልገኘልኩም። ${hint}` : `I could not find a match for that. ${hint}`,
      products: [],
      citations: [],
      suggestions: am
        ? ['በጣም ዝቅተኛ ዋጋ ያላቸው', 'የተመረጡ ምርቶች', 'በብዙ መጠን']
        : ['Cheapest first', 'Top rated', 'In stock only'],
      understood: { bulk: intent.bulk },
      followUp: history.length > 0,
    };
  }

  const top = products[0]!;
  // Only offer a cheaper alternative if one genuinely is cheaper. Results are
  // relevance-ordered, so products[1] is frequently the *more* expensive pick
  // and describing it as "to spend less" would be a lie.
  const alt = products
    .slice(1)
    .filter((p) => p.price < top.price)
    .sort((a, b) => a.price - b.price)[0];
  const seller = top.sellerName ?? '';
  const eta = etaOf(top, db);
  const city = cityOf(top, db);

  let answer: string;
  if (am) {
    answer =
      `ለእርስዎ የሚሆነው **${top.titleAm}** ነው። ` +
      `ዋጋ ${etb(top.price)} ብር፣ በ${seller} የሚሸጣ ሲሆን በ${eta} ቀናው ይደርሳል። ` +
      `ደረጃ ${top.rating.toFixed(1)} ከ${top.reviewCount} ግምገማዎች ያለው ነው።` +
      (alt ? ` ዝቅተኛ ከፈልጉ ${alt.titleAm} በ${etb(alt.price)} ብር ይገኛል።` : '');
  } else {
    answer =
      `The closest match is **${top.title}** at ETB ${etb(top.price)}, sold by ${seller}${city ? ` in ${city}` : ''}. ` +
      `It arrives in ${eta} days and is rated ${top.rating.toFixed(1)} across ${top.reviewCount} reviews.` +
      (alt ? ` To spend less, ${alt.title} is ETB ${etb(alt.price)}.` : '');
  }

  const suggestions = am
    ? ['በጣም ዝቅተኛ ዋጋ', 'ከፍተኛ ደረጃ', 'በብዙ መጠን', 'በዚህ ከተጨማሪ']
    : ['Cheaper options', 'Highest rated', 'Wholesale pricing', 'Something else'];

  return {
    answer,
    products,
    citations: products.map((p) => ({ productId: p.id, slug: p.slug, title: p.title })),
    suggestions,
    understood: {
      category: ctx.category,
      maxMinor: intent.maxMinor,
      brand: intent.brand,
      minRating: intent.minRating,
      bulk: intent.bulk,
    },
    followUp: history.length > 0 && !intent.category,
  };
}
