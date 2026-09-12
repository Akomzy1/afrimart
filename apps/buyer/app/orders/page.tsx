"use client";

import Link from "next/link";
import { PageHeader, ProductGlyph, TruckIcon, type ProductGlyphKind } from "@afrimart/ui";
import { useCart } from "../cart-context";

const dayName = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString("en-US", { weekday: "long" });

type StepState = "done" | "now" | "";

interface TrackStep {
  label: string;
  sub: string;
  state: StepState;
}

/**
 * AfriMart Buyer - Boxes Tracking and Account.html — tracking view (FUL-1..4).
 * Carrier events come from the shipping API (PRD INT-1); there is no order or
 * fulfilment router on the backend yet, so the stages below are the prototype's
 * scripted states. Parcel origins and arrival days derive from cart state so the
 * CART-6 breakdown stays the one the buyer agreed to.
 */
function stepsFor(index: number, arrivesInDays: number): TrackStep[] {
  const packed = index === 0;
  return [
    { label: "Order confirmed", sub: "Tue · sellers notified", state: "done" },
    packed
      ? { label: "Packed by seller", sub: "Wed · photo packing list saved", state: "done" }
      : { label: "Packed by seller", sub: "Being packed fresh today", state: "now" },
    packed
      ? { label: "Shipped", sub: "On its way with the carrier", state: "now" }
      : { label: "Shipped", sub: "Next, once it leaves the shelf", state: "" },
    { label: "Out for delivery", sub: "On the morning of arrival", state: "" },
    { label: "Delivered", sub: `Expected ${dayName(arrivesInDays)}`, state: "" },
  ];
}

export default function OrdersPage() {
  const { parcels, lines } = useCart();

  if (!lines.length) {
    return (
      <>
        <div className="mobile-chrome">
          <PageHeader back="/" eyebrow="Orders" title="Nothing in transit" />
        </div>
        <div className="track-layout">
          <div className="zero">
            <div className="ic">
              <TruckIcon />
            </div>
            <h3 className="serif">No orders yet</h3>
            <p>When you place an order, every parcel and its arrival date shows up here.</p>
            <Link href="/shop" className="btn btn-primary" style={{ marginTop: 20 }}>
              Start shopping
            </Link>
          </div>
        </div>
      </>
    );
  }

  const parcelWord = parcels.length === 1 ? "one parcel" : parcels.length === 2 ? "two parcels" : `${parcels.length} parcels`;

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/" eyebrow="Orders" title="On its way" />
      </div>

      <div className="track-layout">
        {/* CART-6 — the same one-order/many-parcels framing as cart and checkout. */}
        <div className="trk-sum">
          <div className="line">
            Placed <b>Tuesday</b> · arriving in <b>{parcelWord}</b>, one order.
          </div>
        </div>

        <div className="parcels-track">
          {parcels.map((parcel, i) => (
            <div className="parcel-t" key={parcel.key}>
              <div className="ph">
                <div className="ic">
                  <TruckIcon />
                </div>
                <div className="m">
                  <div className="t">From {parcel.storeName}</div>
                  <div className="s">
                    {parcel.lines[0]?.sellerName}
                    {parcel.lines.length > 1 ? ` +${parcel.lines.length - 1} more` : ""} · arrives {dayName(parcel.arrivesInDays)}
                  </div>
                </div>
              </div>

              <div className="tl">
                {stepsFor(i, parcel.arrivesInDays).map((step) => (
                  <div className={`tstep${step.state ? ` ${step.state}` : ""}`} key={step.label}>
                    <div className="lbl">{step.label}</div>
                    <div className="sub">{step.sub}</div>
                  </div>
                ))}
              </div>

              <div className="trk-items">
                {parcel.lines.map((line) => (
                  <div className="ti" key={line.listingId} title={line.name}>
                    <ProductGlyph kind={line.glyph as ProductGlyphKind} />
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>

        <div className="issue">
          <Link href="/account">Something wrong with a delivery?</Link>
        </div>
        <div className="cart-spacer" />
      </div>
    </>
  );
}
