"use client";

import Link from "next/link";
import { trpc } from "@afrimart/api-client";
import { ProductCard, ProductGlyph, Badge } from "@afrimart/ui";
import { glyphForCategory } from "../lib/glyph";
import { useCart } from "../app/cart-context";
import { useToast } from "@afrimart/ui";

/** "Featured staples" home-page grid — SRCH-2, quick-add cards, real data via catalogue.featured. */
export function FeaturedStaples() {
  const { data, isLoading } = trpc.catalogue.featured.useQuery();
  const { add } = useCart();
  const { show } = useToast();

  return (
    <section style={{ padding: "34px 0 0" }}>
      <div className="pad" style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginBottom: 15 }}>
        <h3 className="serif" style={{ fontSize: 25 }}>
          Featured staples
        </h3>
        <Link href="/shop" style={{ fontSize: "12.5px", fontWeight: 600, color: "var(--green)" }}>
          See all
        </Link>
      </div>
      <div className="pad" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 15 }}>
        {isLoading && <p style={{ color: "var(--ink-3)", fontFamily: "var(--serif)", fontStyle: "italic" }}>Loading the market…</p>}
        {data?.map((p) => (
          <ProductCard
            key={p.listingId}
            name={p.name}
            altNames={p.altNames}
            sellerName={p.sellerName}
            priceLabel={`$${(p.priceCents / 100).toFixed(2)}`}
            unitLabel={p.unitLabel}
            flag={p.freshnessGuarantee ? <Badge kind="fresh">Fresh</Badge> : undefined}
            image={<ProductGlyph kind={glyphForCategory(p.category)} />}
            onAdd={() => {
              add();
              show(`${p.name} added to cart`);
            }}
          />
        ))}
      </div>
    </section>
  );
}
