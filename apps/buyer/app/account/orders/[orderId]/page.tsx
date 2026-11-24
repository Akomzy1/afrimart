"use client";

import { use } from "react";
import Link from "next/link";
import { trpc } from "@afrimart/api-client";
import { PageHeader, ProductGlyph, TruckIcon, ChevronLeftIcon } from "@afrimart/ui";
import { glyphForCategory } from "../../../../lib/glyph";
import { ClaimCard, flagIcon, longDate, money, reasonLabel } from "../report-kit";

/**
 * AfriMart Buyer - Boxes Tracking and Account.html — the order, as seen after
 * it has been placed (QC-3). Parcels with their items; on a delivered parcel
 * each item offers "Report a problem", on one that is late the parcel offers
 * "hasn't arrived", and anything already reported shows where that report is.
 *
 * Which buyer is looking comes from the request, not the address bar: another
 * buyer's order id returns "not found", the same as one that does not exist.
 */
export default function OrderPage({ params }: { params: Promise<{ orderId: string }> }) {
  const { orderId } = use(params);
  const order = trpc.orders.detail.useQuery({ orderId });

  if (order.isLoading) return <p className="od-note">Loading your order…</p>;
  if (order.isError || !order.data) {
    return (
      <>
        <div className="mobile-chrome">
          <PageHeader back="/account" eyebrow="Order" title="Your order" />
        </div>
        <p className="od-note">We couldn&apos;t find that order.</p>
      </>
    );
  }

  const o = order.data;
  const itemCount = o.parcels.reduce((n, p) => n + p.items.reduce((m, i) => m + i.quantity, 0), 0);
  const itemsCents = o.parcels.reduce((n, p) => n + p.items.reduce((m, i) => m + i.lineTotalCents, 0), 0);
  const parcelWord = o.parcels.length === 1 ? "one parcel" : o.parcels.length === 2 ? "two parcels" : `${o.parcels.length} parcels`;
  const awaitingDelivery = o.parcels.some((p) => p.status !== "delivered" && p.status !== "declined");

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/account" eyebrow={`Order ${o.ref}`} title="Your order" />
      </div>

      <div className="od-page">
        <div className="od-dt">
          <Link href="/account" className="dback">
            <ChevronLeftIcon /> Your account
          </Link>
          <div className="eyebrow">Order {o.ref}</div>
          <h1 className="serif">Your order</h1>
        </div>

        <div className="od-sum">
          Placed <b>{longDate(o.placedAt)}</b> · {itemCount} {itemCount === 1 ? "item" : "items"} in {parcelWord}, one order.
        </div>

        <div className="od-wrap">
          <div className="od-claims">
            {o.parcels.flatMap((p) =>
              p.claims.map((c) => (
                <ClaimCard
                  key={c.id}
                  claim={c}
                  what={
                    c.kind === "parcel"
                      ? `Parcel from ${p.storeName} hasn't arrived`
                      : `${c.itemIds
                          .map((id) => p.items.find((i) => i.id === id))
                          .filter(Boolean)
                          .map((i) => `${i!.name} ×${i!.quantity}`)
                          .join(", ")} · ${reasonLabel(c.reason)}`
                  }
                />
              )),
            )}
          </div>

          <div className="od-items">
            {o.parcels.map((p) => (
              <section className="od-card" key={p.shipmentId}>
                <div className="hd">
                  <span className="eyebrow">From {p.storeName}</span>
                  <span className={`st ${p.status === "delivered" ? "badge-done" : "badge-late"}`}>
                    {p.status === "declined" ? "Declined by seller" : p.status === "delivered" ? "Delivered" : p.estimatedDelivery ? `Expected ${longDate(p.estimatedDelivery)}` : "On its way"}
                  </span>
                </div>

                {p.items.map((i) => (
                  <div className="od-li" key={i.id}>
                    <div className="th">
                      <ProductGlyph kind={glyphForCategory(i.category)} />
                    </div>
                    <div className="m">
                      <div className="nm">{i.name}</div>
                      <div className="sl">{i.packSize}</div>
                      {i.claim ? (
                        <span className={`cchip ${i.claim.stage === "refunded" ? "done" : "open"}`}>
                          {flagIcon}
                          {i.claim.stage === "refunded"
                            ? `Refunded ${money(i.claim.amountCents)}`
                            : i.claim.stage === "declined"
                              ? "Report not approved"
                              : "Report under review"}
                        </span>
                      ) : p.itemReportBlock === null ? (
                        <Link className="rp" href={`/account/orders/${o.orderId}/report/${p.shipmentId}?item=${i.id}`}>
                          {flagIcon}Report a problem
                        </Link>
                      ) : null}
                    </div>
                    <div className="pr">
                      <div className="v tnum">{money(i.lineTotalCents)}</div>
                      <div className="q">
                        {i.quantity} × {money(i.unitPriceCents)}
                      </div>
                    </div>
                  </div>
                ))}

                {p.status !== "delivered" && p.status !== "declined" && (
                  <div className="od-pfoot">
                    <span className="eta">
                      <TruckIcon />
                      {p.parcelClaim
                        ? "You've reported this parcel"
                        : p.estimatedDelivery
                          ? `On its way — expected ${longDate(p.estimatedDelivery)}`
                          : "On its way"}
                    </span>
                    {!p.parcelClaim && p.parcelReportBlock === null && (
                      <Link className="rp" href={`/account/orders/${o.orderId}/report-parcel/${p.shipmentId}`}>
                        {flagIcon}Hasn&apos;t arrived?
                      </Link>
                    )}
                  </div>
                )}
              </section>
            ))}
          </div>

          <div className="od-card od-tot">
            <div className="r">
              <span>Items</span>
              <span className="v tnum">{money(itemsCents)}</span>
            </div>
            <div className="r">
              <span>Shipping</span>
              <span className="v tnum">{money(o.shippingCents)}</span>
            </div>
            {o.taxCents > 0 && (
              <div className="r">
                <span>Tax</span>
                <span className="v tnum">{money(o.taxCents)}</span>
              </div>
            )}
            <div className="r t">
              <span>Total</span>
              <span className="v tnum">{money(o.totalCents)}</span>
            </div>
          </div>
        </div>
        {awaitingDelivery && <p className="od-fine">You can report a problem with an item once its parcel has arrived.</p>}
        <div className="cart-spacer" />
      </div>
    </>
  );
}
