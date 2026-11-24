"use client";

import { useState } from "react";
import { ProductGlyph, type ProductGlyphKind } from "@afrimart/ui";
import { photoUrl } from "./providers";

export function ListingPhoto({ src, glyph }: { src: string | null; glyph: ProductGlyphKind }) {
  const [failed, setFailed] = useState<string | null>(null);
  if (!src || src === failed) return <ProductGlyph kind={glyph} />;
  // The adjacent product name labels the tile.
  // eslint-disable-next-line @next/next/no-img-element
  return <img className="mr-product-photo" alt="" src={photoUrl(src)} onError={() => setFailed(src)} />;
}
