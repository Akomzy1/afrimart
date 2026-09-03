import type { ReactNode } from "react";
import { HeartIcon, PlusIcon } from "../icons";

export interface ProductCardProps {
  name: string;
  /** Alternate spellings/names — e.g. "Gari · cassava flakes · èbà · 2kg" (SRCH-1). */
  altNames: string;
  sellerName: string;
  shippingNote: string;
  priceLabel: string;
  unitLabel?: string;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  onAdd?: () => void;
  /** Verified/Fresh/Sale badge, rendered top-left over the product shot. */
  flag?: ReactNode;
  /** Product photo/illustration; falls back to a placeholder icon when omitted. */
  image?: ReactNode;
}

/** SRCH-3 — product detail's summary card; also the grid card on browse/search results. */
export function ProductCard({
  name,
  altNames,
  sellerName,
  shippingNote,
  priceLabel,
  unitLabel,
  favorited,
  onToggleFavorite,
  onAdd,
  flag,
  image,
}: ProductCardProps) {
  return (
    <div className="pcard">
      <div className="shot">
        {flag && <span className="flag">{flag}</span>}
        <button type="button" className="fav" onClick={onToggleFavorite} aria-label="Save for later">
          <HeartIcon fill={favorited ? "currentColor" : "none"} stroke={favorited ? "none" : "currentColor"} />
        </button>
        {image}
      </div>
      <div className="body">
        <div className="nm">{name}</div>
        <div className="alt">{altNames}</div>
        <div className="meta">
          <span className="v">{sellerName}</span>
          <span>· {shippingNote}</span>
        </div>
        <div className="pfoot">
          <div className="price">
            {priceLabel} {unitLabel && <small>{unitLabel}</small>}
          </div>
          <button type="button" className="add" onClick={onAdd} aria-label={`Add ${name} to cart`}>
            <PlusIcon />
          </button>
        </div>
      </div>
    </div>
  );
}
