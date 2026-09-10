import type { ProductGlyphKind } from "@afrimart/ui";

export interface RecipeItem {
  name: string;
  altNames: string;
  glyph: ProductGlyphKind;
  qty: number;
  priceCents: number;
  /** AGT-4 — why the agent swapped something, in its own voice. Never silent. */
  substitution?: string;
}

export interface Recipe {
  key: string;
  /** What the buyer's message reads as when this suggestion is chosen. */
  query: string;
  headline: string;
  /** The agent's reply above the basket. */
  say: string;
  title: string;
  /** CART-6 — parcel arrival disclosed before anything reaches the cart. */
  arrival: string;
  items: RecipeItem[];
}

const dayName = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString("en-US", { weekday: "long" });

/**
 * Phase 1 recipe-to-cart only (AGT-2/AGT-3/AGT-4). The prototype scripts three
 * dishes; a real knowledge-graph lookup is a backend concern. Deliberately not
 * here: Plan an Event (AGT-8..13), cook-along follow-up (AGT-7) and cuisine
 * personalization (AGT-14) — all Phase 2, none with prototype coverage.
 */
export const RECIPES: Recipe[] = [
  {
    key: "jollof",
    query: "Jollof rice for 8",
    headline: "Jollof for 8",
    say: "A proper party jollof for eight — here's everything you'll need. I've kept the rice firm and the pepper base generous, the way it should be.",
    title: "Jollof rice · serves 8",
    arrival: `Everything travels from one seller in **Chicago**, so it arrives together by **${dayName(2)}**.`,
    items: [
      { name: "Parboiled rice", altNames: "Long-grain · 5kg", glyph: "wheat", qty: 1, priceCents: 2200,
        substitution: "Kwame & Sons is out of long-grain today — I swapped in Accra Home's parboiled. It holds its shape just as well." },
      { name: "Plum tomatoes", altNames: "Tinned · 6-pack", glyph: "jar", qty: 1, priceCents: 950 },
      { name: "Tomato paste", altNames: "Double concentrate · 400g", glyph: "jar", qty: 1, priceCents: 480 },
      { name: "Ata Rodo", altNames: "Scotch bonnet · 250g", glyph: "pepper", qty: 2, priceCents: 675 },
      { name: "Red onions", altNames: "Net · 2kg", glyph: "onion", qty: 1, priceCents: 540 },
      { name: "Jollof spice blend", altNames: "Curry, thyme, bay · 150g", glyph: "seed", qty: 1, priceCents: 720 },
    ],
  },
  {
    key: "egusi",
    query: "Egusi soup for 6",
    headline: "Egusi soup for 6",
    say: "Egusi soup for six, the way it's meant to be — nutty, rich and deeply green. Here's your basket, measured for a full pot with some to spare.",
    title: "Egusi soup · serves 6",
    arrival: `These come from two sellers, so your order arrives in **two parcels** — ${dayName(2)} and ${dayName(3)}. One order, one total.`,
    items: [
      { name: "Egusi", altNames: "Ground melon seeds · 500g", glyph: "leaf", qty: 2, priceCents: 850 },
      { name: "Red Palm Oil", altNames: "Cold-pressed · 1L", glyph: "jar", qty: 1, priceCents: 1530 },
      { name: "Smoked catfish", altNames: "Whole · 300g", glyph: "fish", qty: 1, priceCents: 1420 },
      { name: "Bitter leaf", altNames: "Washed · 200g", glyph: "leaf", qty: 1, priceCents: 620 },
      { name: "Crayfish", altNames: "Ground · 150g", glyph: "seed", qty: 1, priceCents: 780 },
    ],
  },
  {
    key: "doro",
    query: "Doro wat for 4",
    headline: "Doro wat for 4",
    say: "Doro wat for four — slow-cooked and deep with berbere. I've put in enough spice for the stew to taste like it should, not a polite version of it.",
    title: "Doro wat · serves 4",
    arrival: `One seller in **Washington, DC** has all of it, so it arrives together by **${dayName(3)}**.`,
    items: [
      { name: "Berbere", altNames: "Fresh-blended · 250g", glyph: "seed", qty: 1, priceCents: 990 },
      { name: "Niter kibbeh", altNames: "Spiced clarified butter · 400g", glyph: "butter", qty: 1, priceCents: 1350 },
      { name: "Red onions", altNames: "Net · 2kg", glyph: "onion", qty: 2, priceCents: 540 },
      { name: "Free-range chicken", altNames: "Whole · jointed", glyph: "fish", qty: 1, priceCents: 1680,
        substitution: "The farm's smaller birds sold out this morning — this one's a touch larger, so there'll be a little left over." },
    ],
  },
];

export const RECIPE_SUBTITLES: Record<string, string> = {
  jollof: "A party pot, rice firm and generous",
  egusi: "Nutty, rich and green",
  doro: "Fresh-blended berbere at its best",
};
