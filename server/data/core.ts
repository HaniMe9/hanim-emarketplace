import type { Address, Category, User } from '../../shared/types.ts';
import { daysAgo } from '../lib/ids.ts';

export const users: User[] = [
  { id: 'u_buyer1', name: 'Abebe Kebede', phone: '+251911000111', email: 'abebe@example.et', role: 'buyer', avatarHue: 178, city: 'Addis Ababa', createdAt: daysAgo(420) },
  { id: 'u_buyer2', name: 'Sara Moges', phone: '+251911222333', email: 'sara@example.et', role: 'buyer', avatarHue: 320, city: 'Addis Ababa', createdAt: daysAgo(180) },
  { id: 'u_b2b1', name: 'Dawit Alemu', phone: '+251911444555', email: 'dawit@lemlemtrading.et', role: 'business_buyer', avatarHue: 262, orgId: 'org_lemlem', city: 'Addis Ababa', createdAt: daysAgo(300) },
  { id: 'u_b2b2', name: 'Hiwot Girma', phone: '+251911666777', email: 'hiwot@habesha_retail.et', role: 'business_buyer', avatarHue: 22, orgId: 'org_habesha', city: 'Adama', createdAt: daysAgo(210) },
  { id: 'u_seller1', name: 'Marta Tesfaye', phone: '+251911888999', email: 'marta@selamtech.et', role: 'seller', avatarHue: 160, orgId: 'org_selam', city: 'Addis Ababa', createdAt: daysAgo(500) },
  { id: 'u_seller2', name: 'Yonas Bekele', phone: '+251911101010', email: 'yonas@habeshahome.et', role: 'seller', avatarHue: 44, orgId: 'org_habesha_home', city: 'Addis Ababa', createdAt: daysAgo(430) },
  { id: 'u_seller3', name: 'Rahel Haile', phone: '+251911121212', email: 'rahel@addiscoffee.et', role: 'seller', avatarHue: 30, orgId: 'org_addis', city: 'Addis Ababa', createdAt: daysAgo(280) },
  { id: 'u_seller4', name: 'Nahom Solomon', phone: '+251911232323', email: 'nahom@bulkmart.et', role: 'seller', avatarHue: 200, orgId: 'org_bulkmart', city: 'Addis Ababa', createdAt: daysAgo(690) },
  { id: 'u_seller5', name: 'Feven Getachew', phone: '+251911454545', email: 'feven@hanimarket.et', role: 'seller', avatarHue: 190, orgId: 'org_fbab', city: 'Addis Ababa', createdAt: daysAgo(115) },
  { id: 'u_agent1', name: 'Kalkidan Tadesse', phone: '+251911343434', email: 'kalkidan@courier.et', role: 'agent', avatarHue: 96, city: 'Addis Ababa', createdAt: daysAgo(150) },
  { id: 'u_agent2', name: 'Bereket Assefa', phone: '+251911565656', email: 'bereket@courier.et', role: 'agent', avatarHue: 340, city: 'Addis Ababa', createdAt: daysAgo(90) },
  { id: 'u_admin1', name: 'Selam Worku', phone: '+251911787878', email: 'selam@hanimarket.et', role: 'admin', avatarHue: 210, city: 'Addis Ababa', createdAt: daysAgo(600) },
  { id: 'u_finance1', name: 'Tewodros Girmay', phone: '+251911909090', email: 'tewodros@hanimarket.et', role: 'admin', avatarHue: 130, city: 'Addis Ababa', createdAt: daysAgo(540) },
  { id: 'u_new1', name: 'Kidist Solomon', phone: '+251911000999', email: 'kidist@example.et', role: 'seller', avatarHue: 300, orgId: 'org_newbie', city: 'Adama', createdAt: daysAgo(9) },
  { id: 'u_new2', name: 'Michael Girma', phone: '+251911000888', email: 'michael@example.et', role: 'seller', avatarHue: 14, orgId: 'org_medina', city: 'Mekelle', createdAt: daysAgo(4) },
];

export const addresses: Address[] = [
  { id: 'addr_1', userId: 'u_buyer1', label: 'Home', recipient: 'Abebe Kebede', phone: '+251911000111', city: 'Addis Ababa', subcity: 'Kirkos', woreda: 'Kirkos 05', kebele: '07', house: 'Bole Road, House 412', landmark: 'Opposite Garden Hotel', note: 'Ring the bell twice', isDefault: true },
  { id: 'addr_2', userId: 'u_buyer1', label: 'Office', recipient: 'Abebe Kebede', phone: '+251911000111', city: 'Addis Ababa', subcity: 'Lemi Kura', woreda: 'Lemi Kura 03', kebele: '11', house: 'Airport Road, Bldg C, Office 204', landmark: 'Across from Millennium Hall' },
  { id: 'addr_3', userId: 'u_buyer2', label: 'Home', recipient: 'Sara Moges', phone: '+251911222333', city: 'Addis Ababa', subcity: 'Arada', woreda: 'Arada 01', kebele: '03', house: 'Ras Hailu Road, House 87' },
  { id: 'addr_4', userId: 'u_b2b1', label: 'Warehouse', recipient: 'Dawit Alemu', phone: '+251911444555', city: 'Addis Ababa', subcity: 'Bole', woreda: 'Bole 03', kebele: '05', house: 'Bole Medhanialem, Gate 2', note: 'Goods must be received before 4pm' },
  { id: 'addr_5', userId: 'u_b2b2', label: 'Store', recipient: 'Hiwot Girma', phone: '+251911666777', city: 'Adama', subcity: 'Adama', woreda: 'Adama 02', kebele: '14', house: 'Near Taitu Hotel', landmark: 'Blue gate, ask for Hiwot' },
  { id: 'addr_6', userId: 'u_b2b1', label: 'Branch Office', recipient: 'Dawit Alemu', phone: '+251911444555', city: 'Adama', subcity: 'Adama', woreda: 'Adama 04', kebele: '22', house: 'Taitu Hotel, Building B' },
];

export const categories: Category[] = [
  { id: 'cat_electronics', slug: 'electronics', name: 'Electronics', nameAm: 'ኤሌክትሮኒክስ', icon: 'Cpu', blurb: 'Phones, laptops, audio, home appliances', productCount: 0, accent: '#0d9488' },
  { id: 'cat_home', slug: 'home-living', name: 'Home & Living', nameAm: 'የቤት እቃዎች', icon: 'Sofa', blurb: 'Furniture, kitchen, bedding, decor', productCount: 0, accent: '#b45309' },
  { id: 'cat_fashion', slug: 'fashion', name: 'Fashion', nameAm: 'ሞዴን', icon: 'Shirt', blurb: 'Men, women, traditional wear, shoes', productCount: 0, accent: '#be185d' },
  { id: 'cat_health', slug: 'health-beauty', name: 'Health & Beauty', nameAm: 'ጤና እና ደህንነት', icon: 'HeartPulse', blurb: 'Skincare, haircare, personal care', productCount: 0, accent: '#7c3aed' },
  { id: 'cat_grocery', slug: 'grocery', name: 'Grocery & Food', nameAm: 'ምግብ እና ምግብ', icon: 'Coffee', blurb: 'Coffee, spices, grains, staples', productCount: 0, accent: '#15803d' },
  { id: 'cat_business', slug: 'business-industrial', name: 'Business & Industrial', nameAm: 'ቢዝነስ እና ኢንደት', icon: 'Boxes', blurb: 'Bulk goods, packaging, janitorial', productCount: 0, accent: '#0369a1' },
  { id: 'cat_kids', slug: 'baby-kids', name: 'Baby & Kids', nameAm: 'ልጆችና ጨዋታ', icon: 'Baby', blurb: 'Diapers, toys, school supplies', productCount: 0, accent: '#db2777' },
  { id: 'cat_auto', slug: 'automotive', name: 'Automotive', nameAm: 'መንግሥት', icon: 'Car', blurb: 'Parts, accessories, car care', productCount: 0, accent: '#475569' },
];

const subcats: [string, string, string, string, string][] = [
  ['cat_phones', 'cat_electronics', 'Mobile Phones', 'ስልኮቶች', 'Smartphone'],
  ['cat_laptops', 'cat_electronics', 'Laptops & Computers', 'ላፕቶፖች', 'Laptop'],
  ['cat_audio', 'cat_electronics', 'Audio & Headphones', 'ድምፅና ሰርጣ', 'Headphones'],
  ['cat_appliances', 'cat_electronics', 'Home Appliances', 'የቤት መሣሪያዎች', 'Refrigerator'],
  ['cat_furniture', 'cat_home', 'Furniture', 'የቤት ዕቃ', 'Armchair'],
  ['cat_kitchen', 'cat_home', 'Kitchen & Dining', 'ኩሽናና አመጋገብ', 'ChefHat'],
  ['cat_bedding', 'cat_home', 'Bedding & Textiles', 'ፍራሽና ጨርቅ', 'BedDouble'],
  ['cat_skincare', 'cat_health', 'Skincare', 'የቆም እንክሻ', 'Sparkles'],
  ['cat_haircare', 'cat_health', 'Haircare', 'የፀጉር እንክሻ', 'Scissors'],
  ['cat_coffee', 'cat_grocery', 'Coffee & Tea', 'ቡናና ሻይ', 'Coffee'],
  ['cat_spices', 'cat_grocery', 'Spices & Grains', 'ቅመምና እህል', 'Wheat'],
  ['cat_menswear', 'cat_fashion', "Men's Clothing", 'የወንድ ልብስ', 'Shirt'],
  ['cat_womenswear', 'cat_fashion', "Women's Clothing", 'የሴት ልብስ', 'Dress'],
  ['cat_shoes', 'cat_fashion', 'Shoes', 'ጫማ', 'Footprints'],
  ['cat_bulk', 'cat_business', 'Bulk & Wholesale', 'በጭመብ', 'Package'],
  ['cat_packaging', 'cat_business', 'Packaging', 'ማጠቅለያ', 'Boxes'],
  ['cat_diapers', 'cat_kids', 'Diapers & Baby', 'ደረጃና ልጆች', 'Baby'],
  ['cat_toys', 'cat_kids', 'Toys & Games', 'መዝናኛ', 'ToyBrick'],
  ['cat_autoparts', 'cat_auto', 'Auto Parts', 'የመንግሥት ክፍሎች', 'Cog'],
  ['cat_care', 'cat_auto', 'Car Care', 'የመንግሥት እንክሻ', 'Droplets'],
];

for (const [cid, parent, name, nameAm, icon] of subcats) {
  const p = categories.find((c) => c.id === parent)!;
  categories.push({ id: cid, slug: cid.replace('cat_', ''), name, nameAm, icon, parentId: p.id, blurb: name, productCount: 0, accent: p.accent });
}

export const categoryById = (id: string) => categories.find((c) => c.id === id)!;
export const rootOf = (id: string): string => {
  const c = categories.find((x) => x.id === id);
  return c?.parentId ?? id;
};
