"use client";

import { use, useState } from "react";
import { useRouter } from "next/navigation";
import { trpc } from "@afrimart/api-client";
import { PageHeader, CartButton, LangTag, CartIcon } from "@afrimart/ui";
import { glyphForCategory } from "../../../lib/glyph";
import { useCart } from "../../cart-context";
import { useToast } from "@afrimart/ui";
import { ProductGallery } from "../../../components/ProductGallery";
import { SellerBlock } from "../../../components/SellerBlock";
import { AlsoAvailable } from "../../../components/AlsoAvailable";
import { ShippingEstimator } from "../../../components/ShippingEstimator";
import { UsedInKitchen } from "../../../components/UsedInKitchen";
import { ReviewsBlock } from "../../../components/ReviewsBlock";

/** AfriMart Buyer - Browse and Product.html's Product Detail view — SRCH-3. */
export default function ProductDetailPage({ params }: { params: Promise<{ listingId: string }> }) {
  const { listingId } = use(params);
  const router = useRouter();
  const { count, add } = useCart();
  const { show } = useToast();
  const [qty, setQty] = useState(1);

  const { data, isLoading } = trpc.catalogue.detail.useQuery({ listingId });

  if (isLoading || !data) {
    return (
      <div style={{ padding: 40, textAlign: "center", fontFamily: "var(--serif)", fontStyle: "italic", color: "var(--ink-2)" }}>
        Loading…
      </div>
    );
  }

  const glyph = glyphForCategory(data.category);

  return (
    <>
      <PageHeader back="/shop" eyebrow={`${data.cuisine} · ${data.category}`} right={<CartButton count={count} />} />

      <ProductGallery glyph={glyph} fresh={data.freshnessGuarantee} />

      <div className="pdhead" style={{ padding: "12px 20px 0" }}>
        <h1>{data.name}</h1>
        <div className="langtags">
          {data.langs.map((l) => (
            <LangTag key={l.language} language={l.language} name={l.name} />
          ))}
        </div>
      </div>

      <div className="priceline" style={{ padding: "18px 20px 0" }}>
        <span className="p tnum">${(data.priceCents / 100).toFixed(2)}</span>
        <span className="u">{data.unitLabel}</span>
      </div>
      {data.madeToOrder && (
        <div className="footnote" style={{ margin: "10px 20px 0" }}>
          Made to order — please allow {data.leadTimeDays ?? 3} to {(data.leadTimeDays ?? 3) + 1} days for this seller to prepare your
          batch before it ships.
        </div>
      )}

      <div style={{ margin: "22px 16px 0" }}>
        <SellerBlock sellerName={data.sellerName} verified={data.sellerVerified} rating={data.rating} metro={data.metro} />
      </div>

      <div style={{ margin: "16px 0 0" }}>
        <AlsoAvailable items={data.alsoAvailable} glyph={glyph} unitLabel={data.unitLabel} />
      </div>

      <div style={{ margin: "16px 16px 0" }}>
        <ShippingEstimator shippingDays={data.shippingDays} metro={data.metro} />
      </div>

      <div style={{ margin: "22px 20px 0" }}>
        <UsedInKitchen description={data.usedDescription} onCook={() => router.push("/cook")} />
      </div>

      <div style={{ margin: "22px 16px 0" }}>
        <ReviewsBlock rating={data.rating} reviewCount={data.reviewCount} reviews={data.reviews} />
      </div>
      <div style={{ height: 16 }} />

      <div className="addbar on">
        <div className="qty">
          <button type="button" onClick={() => setQty((q) => Math.max(1, q - 1))} aria-label="Decrease quantity">
            −
          </button>
          <span>{qty}</span>
          <button type="button" onClick={() => setQty((q) => q + 1)} aria-label="Increase quantity">
            +
          </button>
        </div>
        <button
          type="button"
          className="add"
          onClick={() => {
            add(qty);
            show(`${qty} × ${data.name} added to cart`);
          }}
        >
          <CartIcon /> Add to cart · ${((data.priceCents * qty) / 100).toFixed(2)}
        </button>
      </div>
    </>
  );
}
