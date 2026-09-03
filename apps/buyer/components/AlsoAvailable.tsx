import Link from "next/link";
import { SealIcon, ProductGlyph, type ProductGlyphKind } from "@afrimart/ui";
import type { AlsoAvailableData } from "@afrimart/shared";

export interface AlsoAvailableProps {
  items: AlsoAvailableData[];
  glyph: ProductGlyphKind;
  unitLabel: string;
}

/** SRCH-3 — cross-store availability and price for the same canonical product. */
export function AlsoAvailable({ items, glyph, unitLabel }: AlsoAvailableProps) {
  if (!items.length) return null;
  return (
    <div className="block also">
      <div className="bt">Also available from</div>
      {items.map((a) => (
        <Link key={a.listingId} href={`/product/${a.listingId}`} className="row" style={{ textDecoration: "none", color: "inherit" }}>
          <span className="sw">
            <ProductGlyph kind={glyph} />
          </span>
          <div className="m">
            <div className="n">
              {a.sellerName}
              {a.sellerVerified && <SealIcon className="seal" />}
            </div>
            <div className="s">{a.metro} · ships in 1–2 days</div>
          </div>
          <div className="pr">
            <div className="p tnum">${(a.priceCents / 100).toFixed(2)}</div>
            <div className="s">{unitLabel.replace("/ ", "")}</div>
          </div>
        </Link>
      ))}
    </div>
  );
}
