import type { ProductGlyphKind } from "@afrimart/ui";

/**
 * Placeholder product art until real photography exists — every prototype
 * page uses one of five glyphs per product rather than a photo. Category is
 * a reasonable deterministic key since it's already on every card/detail response.
 */
export function glyphForCategory(category: string): ProductGlyphKind {
  switch (category) {
    case "Grains & flours":
      return "wheat";
    case "Oils":
      return "jar";
    case "Spices & seasonings":
      return "seed";
    case "Legumes & seeds":
      return "leaf";
    default:
      return "pepper";
  }
}
