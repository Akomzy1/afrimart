"use client";

import { useState } from "react";
import { ProductGlyph, HeartIcon, type ProductGlyphKind } from "@afrimart/ui";

export interface ProductGalleryProps {
  glyph: ProductGlyphKind;
  fresh: boolean;
}

/** Product detail's image area — no real photography yet, so this is the placeholder-glyph gallery plus favorite toggle. */
export function ProductGallery({ glyph, fresh }: ProductGalleryProps) {
  const [favorited, setFavorited] = useState(false);
  return (
    <>
      {/* Inset comes from .pd-layout .gallery so the desktop tier can drop it. */}
      <div className="gallery">
        {fresh && (
          <span className="flag">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} style={{ width: 13, height: 13 }}>
              <path d="M12 21c5-3 8-6.5 8-11a5 5 0 0 0-9-3 5 5 0 0 0-9 3c0 4.5 3 8 8 11z" />
            </svg>
            <span>Freshness promise</span>
          </span>
        )}
        <button type="button" className={`fav${favorited ? " on" : ""}`} onClick={() => setFavorited((f) => !f)} aria-label="Save for later">
          <HeartIcon fill={favorited ? "currentColor" : "none"} stroke={favorited ? "none" : "currentColor"} />
        </button>
        <span className="g">
          {/* Sized by .gallery .g svg so the desktop tier can enlarge it. */}
          <ProductGlyph kind={glyph} />
        </span>
      </div>
      <div className="am-thumbs">
        {[0, 1, 2].map((i) => (
          <div key={i} className={`t${i === 0 ? " on" : ""}`}>
            <ProductGlyph kind={glyph} />
          </div>
        ))}
      </div>
    </>
  );
}
