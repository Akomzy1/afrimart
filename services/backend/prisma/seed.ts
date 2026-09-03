/**
 * Seeds the exact sample catalogue from the prototypes (AfriMart Buyer App.html's
 * featured staples + AfriMart Buyer - Browse and Product.html's full product set)
 * so the real tRPC endpoints return the same products the design was built around.
 */
import { PrismaClient } from "@prisma/client";

const prisma = new PrismaClient();

interface SeedListing {
  seller: string;
  metro: string;
  state: string;
  verified: boolean;
  price: number;
  madeToOrder?: boolean;
  leadTimeDays?: number;
}

interface SeedProduct {
  name: string;
  shortDescription: string;
  category: string;
  cuisine: string;
  packSize: string;
  temperatureClass: "ambient" | "refrigerated" | "frozen";
  shippingWeightOz: number;
  freshnessGuarantee?: boolean;
  usedDescription: string;
  langs: { language: string; name: string }[];
  searchAliases: string[];
  listings: SeedListing[];
  reviews: { buyerName: string; rating: number; comment: string }[];
}

const products: SeedProduct[] = [
  {
    name: "Egusi",
    shortDescription: "Ground melon seeds",
    category: "Legumes & seeds",
    cuisine: "Nigerian",
    packSize: "500g",
    temperatureClass: "ambient",
    shippingWeightOz: 18,
    freshnessGuarantee: true,
    usedDescription:
      "Ground egusi thickens soups into a rich, nutty stew. Toast it lightly, then simmer with leafy greens, smoked fish and palm oil for a classic egusi soup.",
    langs: [
      { language: "Yoruba", name: "Ẹ̀gúsí" },
      { language: "Igbo", name: "Egwusi" },
      { language: "Hausa", name: "Agushi" },
    ],
    searchAliases: ["melon seeds", "agushi", "egwusi"],
    listings: [
      { seller: "Adunni Foods", metro: "Houston", state: "TX", verified: true, price: 850 },
      { seller: "Mama Kemi Market", metro: "Atlanta", state: "GA", verified: true, price: 820 },
      { seller: "Naija Pantry", metro: "Bronx", state: "NY", verified: false, price: 910 },
    ],
    reviews: [
      { buyerName: "Amara O.", rating: 5, comment: "Exactly like the market back home. Sealed well and arrived quickly." },
      { buyerName: "Kofi B.", rating: 5, comment: "Fresh and fragrant. The whole order came in one delivery even from two sellers." },
    ],
  },
  {
    name: "Garri",
    shortDescription: "Cassava flakes",
    category: "Grains & flours",
    cuisine: "Ghanaian",
    packSize: "2kg",
    temperatureClass: "ambient",
    shippingWeightOz: 72,
    usedDescription:
      "Soak garri in cold water for a quick drink, or stir into hot water to make èbà — the soft, stretchy staple served with soups and stews.",
    langs: [
      { language: "Yoruba", name: "Gaàrí" },
      { language: "Igbo", name: "Garị" },
      { language: "Twi", name: "Gari" },
    ],
    searchAliases: ["gari", "cassava flakes", "èbà", "eba"],
    listings: [
      { seller: "Kwame & Sons", metro: "Chicago", state: "IL", verified: true, price: 1200 },
      { seller: "Accra Home Foods", metro: "Newark", state: "NJ", verified: true, price: 1150 },
    ],
    reviews: [{ buyerName: "Amara O.", rating: 5, comment: "Exactly like the market back home. Sealed well and arrived quickly." }],
  },
  {
    name: "Red Palm Oil",
    shortDescription: "Cold-pressed, unrefined",
    category: "Oils",
    cuisine: "Nigerian",
    packSize: "1L",
    temperatureClass: "ambient",
    shippingWeightOz: 36,
    usedDescription:
      "The soul of West African cooking. A spoonful lends jollof, stews and soups their deep colour and unmistakable flavour.",
    langs: [
      { language: "Igbo", name: "Mmanu ọkụ" },
      { language: "Ewe", name: "Zomi" },
      { language: "Yoruba", name: "Epo pupa" },
    ],
    searchAliases: ["palm oil", "mmanu", "zomi"],
    listings: [
      { seller: "Mama Ngozi", metro: "Bronx", state: "NY", verified: true, price: 1530 },
      { seller: "Lagos Fresh", metro: "Houston", state: "TX", verified: true, price: 1490 },
      { seller: "West Market Co.", metro: "Dallas", state: "TX", verified: false, price: 1600 },
    ],
    reviews: [{ buyerName: "Kofi B.", rating: 5, comment: "Fresh and fragrant. The whole order came in one delivery even from two sellers." }],
  },
  {
    name: "Ata Rodo",
    shortDescription: "Scotch bonnet peppers",
    category: "Spices & seasonings",
    cuisine: "Nigerian",
    packSize: "250g",
    temperatureClass: "ambient",
    shippingWeightOz: 9,
    freshnessGuarantee: true,
    usedDescription: "Blend into pepper sauces and stews for a fruity, fiery heat. A little goes a long way.",
    langs: [
      { language: "Yoruba", name: "Ata rodo" },
      { language: "Igbo", name: "Ose oyibo" },
      { language: "Hausa", name: "Barkono" },
    ],
    searchAliases: ["scotch bonnet", "habanero", "fresh pepper"],
    listings: [
      { seller: "Lagos Fresh", metro: "Houston", state: "TX", verified: true, price: 675 },
      { seller: "Naija Pantry", metro: "Bronx", state: "NY", verified: false, price: 720 },
    ],
    reviews: [],
  },
  {
    name: "Berbere",
    shortDescription: "Spice blend",
    category: "Spices & seasonings",
    cuisine: "Ethiopian",
    packSize: "200g",
    temperatureClass: "ambient",
    shippingWeightOz: 7,
    usedDescription:
      "A fragrant blend of chilli, fenugreek and warm spices — the backbone of doro wat and misir wot. Bloom it in oil to release its aroma.",
    langs: [
      { language: "Amharic", name: "በርበሬ" },
      { language: "Tigrinya", name: "በርበረ" },
    ],
    searchAliases: ["spice blend", "berberé"],
    listings: [
      { seller: "Habesha Spice", metro: "Washington", state: "DC", verified: true, price: 940, madeToOrder: true, leadTimeDays: 4 },
      { seller: "Addis Market", metro: "Seattle", state: "WA", verified: true, price: 980 },
    ],
    reviews: [],
  },
  {
    name: "Suya Spice",
    shortDescription: "Yaji spice",
    category: "Spices & seasonings",
    cuisine: "Nigerian",
    packSize: "150g",
    temperatureClass: "ambient",
    shippingWeightOz: 6,
    usedDescription: "A peanut-based spice rub for grilled meat. Coat beef or chicken generously before it hits the fire.",
    langs: [
      { language: "Hausa", name: "Yaji" },
      { language: "Yoruba", name: "Suya" },
    ],
    searchAliases: ["yaji", "suya pepper", "kuli-kuli spice"],
    listings: [
      { seller: "Kano Grill", metro: "Dallas", state: "TX", verified: false, price: 790 },
      { seller: "Lagos Fresh", metro: "Houston", state: "TX", verified: true, price: 810 },
    ],
    reviews: [],
  },
  {
    name: "Jollof Rice",
    shortDescription: "Long-grain parboiled rice",
    category: "Grains & flours",
    cuisine: "Ghanaian",
    packSize: "5kg",
    temperatureClass: "ambient",
    shippingWeightOz: 176,
    usedDescription: "Firm, separate grains that stand up to the tomato-rich sauce of a proper party jollof.",
    langs: [
      { language: "Wolof", name: "Ceebu" },
      { language: "Twi", name: "Emo" },
    ],
    searchAliases: ["rice", "parboiled rice"],
    listings: [
      { seller: "Kwame & Sons", metro: "Chicago", state: "IL", verified: true, price: 2200 },
      { seller: "Accra Home Foods", metro: "Newark", state: "NJ", verified: true, price: 2150 },
    ],
    reviews: [],
  },
  {
    name: "Plantain Flour",
    shortDescription: "Unripe plantain flour",
    category: "Grains & flours",
    cuisine: "Nigerian",
    packSize: "1kg",
    temperatureClass: "ambient",
    shippingWeightOz: 36,
    usedDescription: "Stir into hot water for a smooth swallow, or bake into wholesome plantain treats.",
    langs: [
      { language: "Yoruba", name: "Èlùbọ̀ ọ̀gẹ̀dẹ̀" },
      { language: "Igbo", name: "Ji oko" },
    ],
    searchAliases: ["plantain", "elubo ogede"],
    listings: [
      { seller: "Mama Ngozi", metro: "Bronx", state: "NY", verified: true, price: 1020 },
      { seller: "West Market Co.", metro: "Dallas", state: "TX", verified: false, price: 1080 },
    ],
    reviews: [],
  },
];

async function main() {
  const hubs = new Map<string, string>();
  for (const p of products) {
    for (const l of p.listings) {
      const key = `${l.metro}, ${l.state}`;
      if (!hubs.has(key)) {
        const hub = await prisma.hubMetro.upsert({
          where: { id: key },
          update: {},
          create: { id: key, name: l.metro, state: l.state },
        });
        hubs.set(key, hub.id);
      }
    }
  }

  const storeIds = new Map<string, string>();
  for (const p of products) {
    for (const l of p.listings) {
      if (storeIds.has(l.seller)) continue;
      const store = await prisma.store.upsert({
        where: { id: l.seller },
        update: {},
        create: {
          id: l.seller,
          name: l.seller,
          ownerName: l.seller,
          sellerType: "store",
          hubMetroId: hubs.get(`${l.metro}, ${l.state}`)!,
          onboardingStatus: "live",
          verificationStatus: l.verified ? "verified" : "pending",
        },
      });
      storeIds.set(l.seller, store.id);
    }
  }

  for (const p of products) {
    const canonical = await prisma.canonicalProduct.upsert({
      where: { id: p.name },
      update: {},
      create: {
        id: p.name,
        canonicalName: p.name,
        shortDescription: p.shortDescription,
        usedDescription: p.usedDescription,
        category: p.category,
        cuisine: p.cuisine,
        packSize: p.packSize,
        images: [],
        temperatureClass: p.temperatureClass,
        shippingWeightOz: p.shippingWeightOz,
      },
    });

    for (const alias of p.searchAliases) {
      await prisma.nameAlias.upsert({
        where: { id: `${p.name}:${alias}` },
        update: {},
        create: { id: `${p.name}:${alias}`, canonicalProductId: canonical.id, alias, language: "phonetic-english", confidence: 0.9 },
      });
    }
    for (const l of p.langs) {
      await prisma.nameAlias.upsert({
        where: { id: `${p.name}:${l.language}:${l.name}` },
        update: {},
        create: {
          id: `${p.name}:${l.language}:${l.name}`,
          canonicalProductId: canonical.id,
          alias: l.name,
          language: l.language,
          confidence: 1,
        },
      });
    }

    for (const l of p.listings) {
      const listing = await prisma.listing.upsert({
        where: { id: `${p.name}:${l.seller}` },
        update: {},
        create: {
          id: `${p.name}:${l.seller}`,
          storeId: storeIds.get(l.seller)!,
          canonicalProductId: canonical.id,
          priceCents: l.price,
          stockStatus: l.madeToOrder ? "made_to_order" : "in_stock",
          leadTimeDays: l.leadTimeDays,
          temperatureClass: p.temperatureClass,
          shippingWeightOz: p.shippingWeightOz,
          freshnessGuarantee: p.freshnessGuarantee ?? false,
        },
      });

      if (l === p.listings[0]) {
        for (const r of p.reviews) {
          await prisma.review.upsert({
            where: { id: `${listing.id}:${r.buyerName}` },
            update: {},
            create: { id: `${listing.id}:${r.buyerName}`, listingId: listing.id, buyerName: r.buyerName, rating: r.rating, comment: r.comment },
          });
        }
      }
    }
  }

  console.log(`Seeded ${products.length} products, ${storeIds.size} stores, ${hubs.size} hub metros.`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => prisma.$disconnect());
