import type { ReactNode } from "react";
import { HeartIcon, PlusIcon, CheckIcon, ShipCheckIcon, SealIcon } from "../icons";

export interface ProductCardProps {
  /**
   * `quick-add` (AfriMart Buyer App.html home "Featured staples"): name, alt,
   * seller line, price + add button. `browse` (AfriMart Buyer - Browse and
   * Product.html shop/search grid): name, italic alt, price, seller (+ seal
   * if verified), a dedicated shipping line — whole card opens the product,
   * no add button. These are genuinely different screens, not one component
   * with a cosmetic flag — don't collapse them further.
   */
  variant?: "quick-add" | "browse";
  name: string;
  /** Alternate spellings/names — e.g. "Gari · cassava flakes · èbà · 2kg" (SRCH-1). */
  altNames: string;
  sellerName: string;
  /** `browse` only — renders the verified seal next to the seller name. */
  verified?: boolean;
  /** e.g. "1-2 days". `quick-add` omits shipping entirely (matches the real screen); `browse` renders "Ships in {shippingNote}". */
  shippingNote?: string;
  priceLabel: string;
  unitLabel?: string;
  favorited?: boolean;
  onToggleFavorite?: () => void;
  /** `quick-add` only. */
  onAdd?: () => void;
  /** `browse` only — the whole card is the open-product action. */
  onOpen?: () => void;
  /** Verified/Fresh/Sale badge, rendered top-left over the product shot. */
  flag?: ReactNode;
  /** Product photo/illustration; falls back to a placeholder icon when omitted. */
  image?: ReactNode;
}

export function ProductCard({
  variant = "quick-add",
  name,
  altNames,
  sellerName,
  verified,
  shippingNote,
  priceLabel,
  unitLabel,
  favorited,
  onToggleFavorite,
  onAdd,
  onOpen,
  flag,
  image,
}: ProductCardProps) {
  const shot = (
    <div className="shot">
      {flag && <span className="flag">{flag}</span>}
      <button
        type="button"
        className={`fav${favorited ? " on" : ""}`}
        onClick={(e) => {
          e.stopPropagation();
          onToggleFavorite?.();
        }}
        aria-label="Save for later"
      >
        <HeartIcon fill={favorited ? "currentColor" : "none"} stroke={favorited ? "none" : "currentColor"} />
      </button>
      {image}
    </div>
  );

  if (variant === "browse") {
    return (
      <button type="button" className="pcard browse" onClick={onOpen}>
        {shot}
        <div className="body">
          <div className="nm">{name}</div>
          <div className="alt">{altNames}</div>
          <div className="price tnum">
            {priceLabel} {unitLabel && <small>{unitLabel}</small>}
          </div>
          <div className="seller">
            {sellerName}
            {verified && <SealIcon className="seal" />}
          </div>
          {shippingNote && (
            <div className="ships">
              <ShipCheckIcon /> Ships in {shippingNote}
            </div>
          )}
        </div>
      </button>
    );
  }

  return (
    <div className="pcard">
      {shot}
      <div className="body">
        <div className="nm">{name}</div>
        <div className="alt">{altNames}</div>
        <div className="v">
          <CheckIcon /> {sellerName}
        </div>
        <div className="foot">
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
