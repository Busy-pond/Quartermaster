import type { Product } from "./channel3";

/**
 * Offline sample products used when Channel3 is switched off or unreachable.
 * They are labelled "sample" in the UI and never shown as live results.
 * Once Channel3 works, replace these with real recorded responses for the demo queries.
 */
const p = (id: string, title: string, vendor: string, price: number, brand: string): Product => ({
  id: `fixture_${id}`,
  title,
  brand,
  vendor,
  priceCents: Math.round(price * 100),
  currency: "USD",
  availability: "InStock",
  imageUrl: null,
  url: null,
  source: "fixture",
});

const FIXTURES: { keywords: string[]; products: Product[] }[] = [
  {
    keywords: ["bottle", "water"],
    products: [
      p("bottle1", "Reusable 24 oz water bottle, BPA-free (single)", "walmart.com", 3.98, "Generic"),
      p("bottle2", "Stainless steel water bottle 20 oz, bulk pack of 24", "uline.com", 89.0, "Uline"),
      p("bottle3", "Collapsible silicone water bottle 18 oz", "amazon.com", 6.49, "Generic"),
    ],
  },
  {
    keywords: ["table", "folding"],
    products: [
      p("table1", "6 ft plastic folding table, white", "walmart.com", 44.97, "Generic"),
      p("table2", "6 ft fold-in-half table, commercial grade", "homedepot.com", 69.0, "Generic"),
      p("table3", "4 ft adjustable-height folding table", "target.com", 54.99, "Generic"),
    ],
  },
  {
    keywords: ["glove"],
    products: [
      p("glove1", "Nitrile-coated work gloves, 12 pairs", "homedepot.com", 24.98, "Generic"),
      p("glove2", "Heavy-duty cleanup gloves, cut resistant (pair)", "amazon.com", 7.99, "Generic"),
    ],
  },
  {
    keywords: ["bag", "trash", "garbage"],
    products: [
      p("bag1", "Contractor trash bags 42 gal, 50 count", "homedepot.com", 29.97, "Generic"),
      p("bag2", "Heavy-duty trash bags 55 gal, 100 count", "uline.com", 38.5, "Uline"),
    ],
  },
  {
    keywords: ["grabber", "picker", "reacher", "litter"],
    products: [
      p("grab1", "Litter picker grabber tool, 32 in", "amazon.com", 9.99, "Generic"),
      p("grab2", "Pick-up tool with rotating head, 35 in", "walmart.com", 12.48, "Generic"),
    ],
  },
  {
    keywords: ["vest", "safety", "hi-vis", "high visibility"],
    products: [
      p("vest1", "High-visibility safety vest, pack of 10", "amazon.com", 23.99, "Generic"),
      p("vest2", "Reflective mesh safety vest (single)", "homedepot.com", 4.98, "Generic"),
    ],
  },
];

export function fixtureSearch(query: string): Product[] {
  const q = query.toLowerCase();
  const hit = FIXTURES.find((f) => f.keywords.some((k) => q.includes(k)));
  return hit ? hit.products : [];
}
