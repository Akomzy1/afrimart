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
  // Route params arrive percent-encoded, and listing ids contain a colon and
  // spaces ("Egusi:Adunni Foods"). Without decoding, the encoded form is sent
  // as the query input and the lookup fails.
  const { listingId: encodedListingId } = use(params);
  const listingId = decodeURIComponent(encodedListingId);
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
      {/* The prototype's product view carries no page header at the desktop tier. */}
      <div className="mobile-chrome">
        <PageHeader back="/shop" eyebrow={`${data.cuisine} · ${data.category}`} right={<CartButton count={count} />} />
      </div>

      {/*
        Grouped into the prototype's two desktop columns. Below 1200px the
        wrappers are display:contents and .pd-layout is a flex column, so
        `order` restores the single-column reading order this screen already
        shipped with — gallery, title, price, seller, delivery, then the
        longer-form blocks.
      */}
      <div className="pd-layout">
        <div className="pdMain">
          <ProductGallery glyph={glyph} fresh={data.freshnessGuarantee} />

          <div className="pd-used">
            <UsedInKitchen description={data.usedDescription} onCook={() => router.push("/cook")} />
          </div>

          <div className="pd-rev">
            <ReviewsBlock rating={data.rating} reviewCount={data.reviewCount} reviews={data.reviews} />
          </div>
        </div>

        <div className="pdRail">
          <div className="pdhead">
            <h1>{data.name}</h1>
            <div className="langtags">
              {data.langs.map((l) => (
                <LangTag key={l.language} language={l.language} name={l.name} />
              ))}
            </div>
          </div>

          <div className="priceline">
            <span className="p tnum">${(data.priceCents / 100).toFixed(2)}</span>
            <span className="u">{data.unitLabel}</span>
          </div>

          {data.madeToOrder && (
            <div className="footnote pd-footnote">
              Made to order — please allow {data.leadTimeDays ?? 3} to {(data.leadTimeDays ?? 3) + 1} days for this seller to prepare your
              batch before it ships.
            </div>
          )}

          <div className="pd-seller">
            <SellerBlock sellerName={data.sellerName} verified={data.sellerVerified} rating={data.rating} metro={data.metro} />
          </div>

          <div className="pd-also">
            <AlsoAvailable items={data.alsoAvailable} glyph={glyph} unitLabel={data.unitLabel} />
          </div>

          <div className="pd-est">
            <ShippingEstimator shippingDays={data.shippingDays} metro={data.metro} />
          </div>
        </div>
      </div>
      <div style={{ height: 16 }} />

      <div className="addbar on pd-addbar">
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
