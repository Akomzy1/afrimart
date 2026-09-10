"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PageHeader,
  ShippingProgress,
  ProductGlyph,
  ParcelGroup,
  CartLineItem,
  OrderSummary,
  ActionBar,
  BigButton,
  SealIcon,
  ArrowRightIcon,
  SparkleIcon,
} from "@afrimart/ui";
import { useCart, FREE_SHIPPING_THRESHOLD_CENTS } from "../cart-context";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dayName = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString("en-US", { weekday: "long" });

/** AfriMart Buyer - Cart and Checkout.html — cart view. CART-2/3/5/6. */
export default function CartPage() {
  const router = useRouter();
  const { parcels, lines, count, sellerCount, subtotalCents, shippingCents, totalCents, setQty, remove } = useCart();

  if (!lines.length) {
    return (
      <>
        <div className="mobile-chrome">
          <PageHeader back="/shop" eyebrow="Your cart" title="Nothing here yet" />
        </div>
        <div className="cart-layout">
          <div className="zero">
            <div className="ic">
              <SealIcon />
            </div>
            <h3 className="serif">Your cart is empty</h3>
            <p>Browse the market and add a few staples — we&apos;ll keep them together in as few parcels as possible.</p>
            <Link href="/shop" className="btn btn-primary" style={{ marginTop: 20 }}>
              Start shopping <ArrowRightIcon />
            </Link>
          </div>
        </div>
      </>
    );
  }

  const arrivals = parcels.map((p) => dayName(p.arrivesInDays));
  const parcelSentence =
    parcels.length === 1
      ? `Your order arrives in one parcel — ${arrivals[0]}. One order, one total.`
      : `Your order arrives in ${parcels.length === 2 ? "two" : String(parcels.length)} parcels — ${arrivals
          .slice(0, -1)
          .join(", ")} and ${arrivals[arrivals.length - 1]}. One order, one total.`;

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/shop" eyebrow="Your cart" title="Ready to ship" />
      </div>

      <div className="cart-layout">
        <div className="cartMain">
          <div className="cart-freebar">
            <ShippingProgress subtotalCents={subtotalCents} thresholdCents={FREE_SHIPPING_THRESHOLD_CENTS} />
          </div>

          {/* CART-6 — multi-parcel arrival disclosed up front, never hidden. */}
          <div className="parcelnote">
            <p>{parcelSentence}</p>
          </div>

          <div className="cart-parcels">
            {parcels.map((parcel) => (
              <ParcelGroup
                key={parcel.key}
                originLabel={parcel.originMetro.split(",")[0]}
                arrivesLabel={dayName(parcel.arrivesInDays)}
                temperatureLabel={parcel.temperature === "perishable" ? "chilled" : undefined}
              >
                {parcel.lines.map((line) => (
                  <CartLineItem
                    key={line.id}
                    name={line.name}
                    altNames={line.altNames}
                    sellerName={line.sellerName}
                    verified={line.sellerVerified}
                    unitLabel={line.unitLabel}
                    priceLabel={money(line.priceCents * line.qty)}
                    qty={line.qty}
                    image={<ProductGlyph kind={line.glyph} />}
                    onQtyChange={(q) => setQty(line.id, q)}
                    onRemove={() => remove(line.id)}
                  />
                ))}
              </ParcelGroup>
            ))}
          </div>

          {/* AGT-1 — Cook is offered beside the cart, never in front of it. */}
          <div className="cart-cook">
            <button type="button" onClick={() => router.push("/cook")}>
              <SparkleIcon /> Cooking something specific? Ask Cook to fill the gaps
            </button>
          </div>
        </div>

        <div className="cartRail">
          <div className="cart-summary">
            <OrderSummary
              itemCount={count}
              sellerCount={sellerCount}
              parcelCount={parcels.length}
              subtotalLabel={money(subtotalCents)}
              shippingLabel={shippingCents === 0 ? "Free" : money(shippingCents)}
              totalLabel={money(totalCents)}
            />
          </div>
          <div className="dRailActions">
            <BigButton onClick={() => router.push("/checkout")}>
              Checkout · {money(totalCents)}
            </BigButton>
          </div>
        </div>
      </div>

      <div className="cart-spacer" />

      <ActionBar summaryLeft="Total" summaryRight={<b>{money(totalCents)}</b>} trust="Secure checkout">
        <BigButton onClick={() => router.push("/checkout")}>
          Checkout <ArrowRightIcon />
        </BigButton>
      </ActionBar>
    </>
  );
}
