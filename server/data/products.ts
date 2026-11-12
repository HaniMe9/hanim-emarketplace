import type { Product } from '../../shared/types.ts';
import { daysAgo } from '../lib/ids.ts';

export type SeedProduct = {
  t: string;
  am: string;
  cat: string;
  brand?: string;
  price: number;
  cmp?: number;
  d: string;
  a: Record<string, string>;
  tags: string[];
  moq?: number;
  rating: number;
  reviews: number;
  sold: number;
  specs?: { label: string; value: string }[];
};

export const seedProducts: SeedProduct[] = [
  {
    t: 'Samsung Galaxy A55 5G — 128GB, 8GB RAM', am: 'ሳምሰን ላይክስ A55 5G — 128ጊባ', cat: 'cat_phones', brand: 'Samsung', price: 2840000, cmp: 3100000, rating: 4.6, reviews: 412, sold: 1830, moq: 5,
    d: 'A 6.6" Super AMOLED 120Hz display, a 50MP OIS main camera and a 5000mAh battery that comfortably lasts a full day of heavy use. Gorilla Glass Victus+ front and back, IP67 water resistance and four years of OS updates make it the safest mid-range pick on the market right now.',
    a: { Display: '6.6" Super AMOLED 120Hz', Storage: '128 GB', RAM: '8 GB', Camera: '50MP OIS + 8MP + 5MP', Battery: '5000 mAh, 25W', Network: '5G Dual SIM', Warranty: '12 months manufacturer' },
    tags: ['5g', 'samsung', 'android', 'best-seller'],
    specs: [{ label: 'Chipset', value: 'Exynos 1480' }, { label: 'Weight', value: '213 g' }, { label: 'Charging', value: '25W wired' }, { label: 'In the box', value: 'Cable, SIM ejector, case' }],
  },
  {
    t: 'Tecno Spark 30 Pro — 256GB, 8GB RAM', am: 'ቴክኖ ስፓርክ 30 ፕሮ — 256ጊባ', cat: 'cat_phones', brand: 'Tecno', price: 1980000, cmp: 2250000, rating: 4.4, reviews: 288, sold: 2240, moq: 10,
    d: 'Big 6.78" AMOLED at 120Hz, 108MP triple camera with AI night mode, and a 5000mAh battery. Widely serviced by local repair shops, which makes it the value pick for anyone who wants a large screen without flagship pricing.',
    a: { Display: '6.78" AMOLED 120Hz', Storage: '256 GB', RAM: '8 GB', Camera: '108MP triple AI', Battery: '5000 mAh, 33W', Warranty: '12 months' },
    tags: ['tecno', 'value', 'affordable', 'big-screen'],
  },
  {
    t: 'Apple iPhone 15 — 128GB, sealed, local warranty', am: 'አፕል አይፎን 15 — 128ጊባ በዋስትራጭ', cat: 'cat_phones', brand: 'Apple', price: 9650000, cmp: 10400000, rating: 4.8, reviews: 96, sold: 320,
    d: 'Imported sealed unit with a 12-month local warranty handled end-to-end by HaniMarket, so claims do not require shipping the phone back out of the country. Ships from the fulfilment hub within 48 hours.',
    a: { Display: '6.1" Super Retina XDR', Storage: '128 GB', Camera: '48MP + 12MP ultrawide', Battery: '3349 mAh', Warranty: '12 months HaniMarket local' },
    tags: ['apple', 'premium', 'import'],
  },
  {
    t: 'JBL Tune 770NC Wireless ANC Headphones', am: 'JBL ተውን 770NC የክላ ማዕረጃ ሰርጣ', cat: 'cat_audio', brand: 'JBL', price: 385000, cmp: 449000, rating: 4.5, reviews: 214, sold: 1450,
    d: 'Adaptive noise cancelling, 70-hour battery with ANC off, and JBL Pure Bass tuning. Folds flat for travel and supports multipoint pairing so you can move between laptop and phone without re-pairing.',
    a: { Type: 'Over-ear wireless', ANC: 'Adaptive, 4 microphones', Battery: '70 h (ANC off)', Bluetooth: '5.3 multipoint', Warranty: '12 months' },
    tags: ['jbl', 'anc', 'audio'],
  },
  {
    t: 'Sony WH-1000XM5 Noise Cancelling Headphones', am: 'ሶኒ WH-1000XM5 የኑይስ ሰርጣ', cat: 'cat_audio', brand: 'Sony', price: 1420000, cmp: 1580000, rating: 4.9, reviews: 132, sold: 410,
    d: 'The reference class for travel headphones. Eight microphones, adaptive cancelling that adjusts to the environment, 30-hour battery, multipoint Bluetooth and a speak-to-chat feature that is genuinely useful in a taxi.',
    a: { Type: 'Over-ear wireless', ANC: 'Adaptive, 8 microphones', Battery: '30 h', Bluetooth: '5.2 multipoint' },
    tags: ['sony', 'anc', 'premium'],
  },
  {
    t: 'HP EliteBook 840 G9 — i7 12th Gen, 16GB, 512GB', am: 'HP EliteBook 840 G9 — i7 12ኛኛ ስልት፣ 16ጊባ', cat: 'cat_laptops', brand: 'HP', price: 4780000, cmp: 5200000, rating: 4.7, reviews: 74, sold: 210,
    d: 'Business-grade ultrabook with vPro security, a 14" 400-nit display and all-day battery. Intel i7-12700, 16GB DDR5, 512GB NVMe, Windows 11 Pro licensed — the machine most of our B2B buyers standardise on.',
    a: { CPU: 'Intel Core i7-12700', RAM: '16GB DDR5', Storage: '512GB NVMe SSD', Display: '14" FHD 400 nits', OS: 'Windows 11 Pro' },
    tags: ['hp', 'laptop', 'business'],
  },
  {
    t: 'Lenovo IdeaPad Slim 3 — Ryzen 5, 16GB, 512GB', am: 'ሌኖቭኦ አይዲያፓድ ስሊም 3 — Ryzen 5', cat: 'cat_laptops', brand: 'Lenovo', price: 2340000, cmp: 2650000, rating: 4.3, reviews: 156, sold: 480,
    d: 'The default student and office laptop in Ethiopia. Ryzen 5 7520U, 16GB RAM with a free upgrade slot, 512GB SSD and a full-size numeric keypad that students actually use.',
    a: { CPU: 'AMD Ryzen 5 7520U', RAM: '16GB (upgradeable)', Storage: '512GB SSD', Display: '15.6" FHD' },
    tags: ['lenovo', 'laptop', 'student', 'value'],
  },
  {
    t: 'Midea 250L Double-Door Refrigerator, inverter', am: 'ሚዲያ 250ሊ ድርሰኛ ፍሪጅ', cat: 'cat_appliances', brand: 'Midea', price: 1120000, cmp: 1290000, rating: 4.4, reviews: 210, sold: 620,
    d: '250 litres with a five-star energy rating, inverter compressor and no-frost cooling. Ten-year compressor warranty, delivered and installed inside your home by the seller team, old unit taken away free.',
    a: { Capacity: '250 L', Energy: '5-star inverter', Warranty: '10 yr compressor', Power: '220V / 50Hz' },
    tags: ['midea', 'fridge', 'appliance'],
  },
  {
    t: 'Hisense 55" 4K Smart TV with Dolby Vision', am: 'ሃይሰንስ 55 ኢንች 4K ስማርት ቲቪ', cat: 'cat_appliances', brand: 'Hisense', price: 1680000, cmp: 1890000, rating: 4.5, reviews: 168, sold: 540,
    d: '55-inch 4K panel with Dolby Vision and HDR10+, 60W Atmos audio, and all three HDMI 2.1 ports free — so a next-gen console does not force a downgrade on the picture.',
    a: { Size: '55 inch', Resolution: '4K UHD 3840x2160', HDR: 'Dolby Vision + HDR10+', Ports: '3x HDMI 2.1, 2x USB', Warranty: '24 months' },
    tags: ['tv', 'hisense', '4k', 'electronics'],
  },
  {
    t: 'Handwoven Ethiopian Cotton Throw Blanket (Qobo)', am: 'በእጅ የተራረ የኢትዮጵያ ጥጥ ፍራሽ', cat: 'cat_bedding', brand: 'Habesha Loom', price: 42000, cmp: 52000, rating: 4.8, reviews: 324, sold: 1420,
    d: '100% long-staple Ethiopian cotton, handwoven on a traditional qobo loom in Arba Minch. Softens with every wash. Each piece takes about nine days on the loom, which is why we do not discount it.',
    a: { Material: '100% Ethiopian cotton', Size: '140 x 200 cm', Weight: '480 g', Care: 'Machine wash cold', Origin: 'Arba Minch, SNNPR' },
    tags: ['handmade', 'cotton', 'ethiopian', 'supporting-artisans'],
  },
  {
    t: 'Solid Teak Wood Dining Table — 6 seater', am: 'የሲዳር ድል የበትት መጠረጃ ሥንት', cat: 'cat_furniture', brand: 'Habesha Home', price: 385000, cmp: 460000, rating: 4.6, reviews: 64, sold: 180,
    d: 'Kiln-dried solid teak with a hand-rubbed oil finish. Seats six comfortably and holds 120kg evenly distributed. Delivered assembled by our own team inside Addis rather than flat-packed.',
    a: { Material: 'Solid teak', Size: '180 x 90 x 75 cm', Finish: 'Hand-rubbed natural oil', Assembly: 'Free inside Addis', Weight: '38 kg' },
    tags: ['teak', 'dining', 'furniture', 'solid-wood'],
  },
  {
    t: 'Buna Craft Pour-Over Coffee Set (የቡና ጉርጫ)', am: 'የቡና ክራፍት ጉርጫ ስብስብ', cat: 'cat_coffee', brand: 'Addis Coffee Estate', price: 28500, cmp: 34000, rating: 4.9, reviews: 508, sold: 3120,
    d: 'Borosilicate glass carafe, stainless filter and a hand-thrown ceramic dripper. Brews two cups in four minutes and pairs with our Yirgacheffe washed beans without any adjustment.',
    a: { Capacity: '600 ml', Material: 'Borosilicate glass + steel', Includes: 'Carafe, filter, dripper', Dishwasher: 'Glass parts only' },
    tags: ['coffee', 'buna', 'pour-over', 'handmade'],
  },
  {
    t: 'Yirgacheffe Washed Coffee Beans — 1kg, roasted to order', am: 'የይርጋችፌ የተበረቀቀ የቡና እንኳሎች 1ኪሎ', cat: 'cat_coffee', brand: 'Addis Coffee Estate', price: 48000, cmp: 56000, rating: 4.8, reviews: 892, sold: 5240,
    d: 'Grade 1 washed Yirgacheffe from 1,850–1,950m, jasmine and bergamot on the nose with a clean citrus finish. Roasted every Tuesday and Friday, so what lands is never more than five days off roast.',
    a: { Grade: 'Grade 1 washed', Altitude: '1,850–1,950 m', Weight: '1 kg', Roast: 'Medium-light', Origin: 'Gedeo Zone, SNNPR' },
    tags: ['coffee', 'yirgacheffe', 'buna', 'specialty', 'best-seller'],
  },
  {
    t: 'Orthodox Ethiopian Coffee Cherries — 5kg', am: 'ዝግጁ የኢትዮጵያ ቡና 5ኪሎ', cat: 'cat_coffee', brand: 'Addis Coffee Estate', price: 62000, cmp: 75000, rating: 4.6, reviews: 186, sold: 890,
    d: 'Natural-process Grade 2 cherries from our Bule Hora station. Sold raw for home roasting or for the jebena ceremony, where the customer usually wants a whole sack rather than a kilo.',
    a: { Process: 'Natural, sun-dried', Grade: 'Grade 2', Weight: '5 kg', Moisture: '10–12%' },
    tags: ['coffee', 'cherries', 'raw', 'jebena'],
  },
  {
    t: 'Spiced Mitmita (ሚጥሚጣ) Teff Flour — 5kg', am: 'የሚጥሚጣ ስጣ ዱቄት 5ኪሎ', cat: 'cat_spices', brand: 'Habesha Millers', price: 95000, cmp: 110000, rating: 4.7, reviews: 412, sold: 2210,
    d: 'Stone-ground teff blended with berbere, korarima and awaze in the proportion we would use at home. No preservatives, milled weekly at a family mill outside Debre Libanos.',
    a: { Weight: '5 kg', Grain: '100% teff', 'Best for': 'Injera, kincho', 'Shelf life': '6 months', Origin: 'Debre Libanos, Oromia' },
    tags: ['teff', 'mitmita', 'injera', 'traditional', 'grocery'],
  },
  {
    t: 'Nigerian Wax Print Cotton Fabric — 6 yards', am: 'የናይጅሪያ የፍራሽ ሽመና ጨርቅ 6 ያርድ', cat: 'cat_womenswear', brand: 'Kíchen Moda', price: 68000, cmp: 82000, rating: 4.5, reviews: 268, sold: 1340,
    d: 'High-thread-count wax print with a soft hand feel that survives repeated washing. Sold in 6-yard bundles, pre-measured and colour-fast, so a tailor does not have to guess before cutting.',
    a: { Composition: '100% cotton', Length: '6 yards', Width: '44 inches', Care: 'Cold wash, no bleach' },
    tags: ['wax-print', 'fabric', 'traditional', 'sewing'],
  },
  {
    t: "Men's Habesha Kemis — full suit with netela", am: 'የወንድ አያል ጫማና ሻርም — ሙሉ ስውት', cat: 'cat_menswear', brand: 'Kíchen Moda', price: 385000, cmp: 445000, rating: 4.6, reviews: 94, sold: 320,
    d: 'Full traditional suit with an embroidered netela-style collar, cut from handloom cotton with a silk-blend sheen. Includes shamma, netela and shirt; made to measure in five working days.',
    a: { Includes: 'Shamma, netela, shirt', Fabric: 'Handloom cotton / silk blend', Sizes: 'S – XXL', 'Made in': 'Addis Ababa' },
    tags: ['traditional', 'menswear', 'kemis', 'handloom'],
  },
  {
    t: 'Hydrating Ceramide Moisturiser — 50ml', am: 'የሰርአሚድ ማርጠጃ ክሬም 50ሚል', cat: 'cat_skincare', brand: 'Glow Beauty', price: 12500, cmp: 14900, rating: 4.4, reviews: 340, sold: 1840,
    d: 'Ceramide NP + AP + EOP with 5% panthenol and squalane. Non-comedogenic, fragrance-free and tested on sensitive skin, which is the main reason our customers come back rather than the marketing.',
    a: { 'Key actives': 'Ceramide complex, 5% panthenol', 'Skin type': 'All, including sensitive', Size: '50 ml' },
    tags: ['skincare', 'ceramide', 'sensitive', 'fragrance-free'],
  },
  {
    t: 'Mineral Sunscreen SPF 50 PA++++ — 75ml', am: 'ሚኒራል ሱልፔር ስክሪን SPF 50 — 75ሚል', cat: 'cat_skincare', brand: 'Glow Beauty', price: 16800, cmp: 19500, rating: 4.7, reviews: 412, sold: 2260,
    d: '100% mineral filters — zinc oxide and titanium dioxide, formulated locally so there is no white cast on medium to deep skin tones. Water-resistant for 80 minutes.',
    a: { SPF: 'SPF 50 PA++++', Filters: 'Zinc oxide, titanium dioxide', Finish: 'Natural, no white cast', 'Water resistant': '80 min' },
    tags: ['sunscreen', 'spf50', 'mineral', 'skincare', 'best-seller'],
  },
  {
    t: 'Ethiopian Raw Shea Butter — 500g, unrefined', am: 'ያልተጠራ የኢትዮጵያ ሺያ ቅብ 500ግ', cat: 'cat_haircare', brand: 'Habesha Naturals', price: 8900, cmp: 10500, rating: 4.8, reviews: 276, sold: 1620,
    d: 'Unrefined shea from women\'s cooperatives in the South, with nothing added. Excellent for hair masks, dry skin and stretch marks. A 500g block lasts most households about two months.',
    a: { Form: 'Unrefined, solid', Weight: '500 g', Use: 'Hair, skin, lips', Scent: 'None, natural' },
    tags: ['shea', 'natural', 'hair', 'unrefined'],
  },
  {
    t: 'Huggies Extra Absorbent Diapers Size 4 — 240 count', am: 'ሃጊስ ኤክስትራ አብሶርበንት ዲያፕር ጂንት 4 — 240ቁርብ', cat: 'cat_diapers', brand: 'Huggies', price: 395000, cmp: 460000, rating: 4.7, reviews: 512, sold: 2180, moq: 10,
    d: '240 pieces across 12 packs of 20 — roughly 26% cheaper per piece than any retail unit price in Addis, which is why it moves fastest in B2B. Genuine sealed product, not a parallel import.',
    a: { Size: '4 (9–14 kg)', Count: '240 pieces (12 packs)', 'Per piece': 'ETB 1.65', Warranty: 'Genuine, sealed', MOQ: '10 packs' },
    tags: ['diapers', 'bulk', 'baby', 'wholesale', 'moq'],
    specs: [{ label: 'Carton', value: '12 packs of 20' }, { label: 'Case weight', value: '9.4 kg' }],
  },
  {
    t: 'Multi-Purpose Building Blocks — 1000 piece set', am: 'ብርሃን ጥናት ካብሮች — 1000ቁርብ', cat: 'cat_toys', brand: 'Kids World', price: 32000, cmp: 39000, rating: 4.3, reviews: 88, sold: 420,
    d: '1000 ABS bricks with 30 unique shapes, a storage tub and three baseplates. Compatible with the major brick brands, so it mixes with collections a child already owns instead of starting over.',
    a: { Pieces: '1,000', Material: 'ABS plastic', Safety: 'EN71 certified', Storage: 'Tub included' },
    tags: ['toys', 'kids', 'blocks'],
  },
  {
    t: 'Toyota Corolla Brake Pad Set — front axle', am: 'የቶዮታ ኮሮላ ብራክ ፓድ ስብስብ — ፊት', cat: 'cat_autoparts', brand: 'Genuine OEM', price: 38500, cmp: 45000, rating: 4.6, reviews: 142, sold: 680,
    d: 'Genuine OEM pads for Corolla 2019 onwards, complete with hardware and shims. Same-day delivery inside Addis for anything ordered before 3pm, because a car off the road costs more than the parts.',
    a: { Fits: 'Corolla 2019–2024', Position: 'Front axle', Type: 'Ceramic', Warranty: '6 months / 10,000 km' },
    tags: ['brake', 'toyota', 'corolla', 'parts'],
  },
  {
    t: 'Engine Oil 5W-30 Fully Synthetic — 4L', am: 'የኢንጂን ኦይል 5W-30 ሙሉ ሲንተቲክ 4ሊ', cat: 'cat_care', brand: 'Mobil', price: 52000, cmp: 60000, rating: 4.5, reviews: 210, sold: 1120,
    d: 'Fully synthetic 5W-30 meeting API SP and ACEA A3/B4. The default fill for modern petrol vehicles on our service bookings, and the one we would put in our own car.',
    a: { Viscosity: '5W-30', Volume: '4 L', Spec: 'API SP, ACEA A3/B4' },
    tags: ['oil', 'engine', 'synthetic'],
  },
  {
    t: 'Corrugated Shipping Box 40x30x30cm — 25 pcs', am: 'የኮርጌት የማጠልቀያ ቅርጫ 40x30x30 — 25ቁርብ', cat: 'cat_packaging', brand: 'Bulkmart', price: 32000, cmp: 38000, rating: 4.3, reviews: 64, sold: 890, moq: 20,
    d: 'Double-wall BC flute at 32 ECT, holds up to 25kg. Consistent sizing matters more than price when boxes are heading into a fulfilment centre, and ours run within 3mm across the run.',
    a: { Dimensions: '40 x 30 x 30 cm', Flute: 'BC double wall', Strength: '32 ECT', Quantity: '25 pieces' },
    tags: ['packaging', 'box', 'shipping', 'bulk', 'moq'],
  },
  {
    t: 'Industrial Degreaser Concentrate — 20L', am: 'የኢንደስትሪያል የማጽዳት መድሃኒት 20ሊ', cat: 'cat_bulk', brand: 'Bulkmart', price: 145000, cmp: 168000, rating: 4.4, reviews: 42, sold: 340, moq: 4,
    d: 'Heavy-duty alkaline degreaser for workshops and institutional kitchens. Dilutes 1:20 for routine use and 1:5 for engine bays. Supplied with a dosing pump because measuring by eye is how people get it wrong.',
    a: { Volume: '20 L', Dilution: '1:20 routine, 1:5 heavy', pH: '12.5', Includes: 'Dosing pump' },
    tags: ['cleaning', 'industrial', 'bulk', 'moq'],
  },
  {
    t: 'Whole Wheat Flour (ስንጥር) — 25kg sack', am: 'ሙሉ የስንጥር ዱቄት 25ኪሎ ከረጢት', cat: 'cat_spices', brand: 'Habesha Millers', price: 185000, cmp: 205000, rating: 4.4, reviews: 158, sold: 1240, moq: 20,
    d: 'Commercial-grade whole wheat flour in a 25kg woven sack for bakeries, hotels and canteens. Milled from Ethiopian highland wheat at 11.5% protein, no additives.',
    a: { Weight: '25 kg', Grade: 'Commercial / bakery', Protein: '11.5%', Packaging: 'Woven PP sack' },
    tags: ['flour', 'wheat', 'bulk', 'bakery', 'moq'],
  },
  {
    t: 'Disposable Nitrile Gloves — 1000 pieces', am: 'የአንበሳ ኒትሪል ጓንት — 1000ቁርብ', cat: 'cat_bulk', brand: 'Bulkmart', price: 98000, cmp: 115000, rating: 4.5, reviews: 38, sold: 520, moq: 5,
    d: 'Powder-free nitrile examination gloves, 100 per box, 10 boxes per case. Food-safe grade to EN 455, so the same case works for a bakery and a clinic.',
    a: { Material: 'Nitrile', Quantity: '1,000 pcs (10 boxes)', Sizes: 'S / M / L / XL', Standard: 'EN 455' },
    tags: ['gloves', 'medical', 'bulk', 'food-safe', 'moq'],
  },
];

export function buildProducts(): Product[] {
  return seedProducts.map((s, i) => ({
    id: `p_${String(i + 1).padStart(3, '0')}`,
    slug: slugify(s.t),
    title: s.t,
    titleAm: s.am,
    description: s.d,
    categoryId: s.cat,
    brand: s.brand,
    attributes: s.a,
    images: [`/api/media/p${String(i + 1).padStart(3, '0')}_0`, `/api/media/p${String(i + 1).padStart(3, '0')}_1`, `/api/media/p${String(i + 1).padStart(3, '0')}_2`],
    rating: s.rating,
    reviewCount: s.reviews,
    soldCount: s.sold,
    viewCount: Math.round(s.sold * (14 + (i % 9) * 3.1)),
    tags: s.tags,
    createdAt: daysAgo(30 + ((i * 7) % 200)),
    moq: s.moq ?? null,
    specSheet: s.specs,
  }));
}

export function slugify(s: string): string {
  return s
    .toLowerCase()
    .replace(/["']/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 60);
}
