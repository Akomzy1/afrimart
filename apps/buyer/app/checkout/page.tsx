"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  PageHeader,
  CheckoutSection,
  FormField,
  OrderSummary,
  ActionBar,
  BigButton,
  TruckIcon,
  CheckIcon,
  LockIcon,
  ClockIcon,
} from "@afrimart/ui";
import { trpc } from "@afrimart/api-client";
import { useCart, DEMO_BUYER_ID } from "../cart-context";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const dayShort = (offset: number) =>
  new Date(Date.now() + offset * 86400000).toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });

type PayMethod = "card" | "paypal";

/** AfriMart Buyer - Cart and Checkout.html — checkout view. */
export default function CheckoutPage() {
  const router = useRouter();
  const { parcels, lines, count, sellerCount, subtotalCents, shippingCents, totalCents } = useCart();

  const [name, setName] = useState("");
  const [street, setStreet] = useState("");
  const [city, setCity] = useState("");
  const [state, setState] = useState("");
  const [zip, setZip] = useState("");
  const [pay, setPay] = useState<PayMethod>("card");
  const [wallet, setWallet] = useState<string | null>(null);
  const [attempted, setAttempted] = useState(false);
  const [placed, setPlaced] = useState(false);
  const [orderId, setOrderId] = useState<string | null>(null);
  const place = trpc.checkout.place.useMutation();

  const zipValid = /^\d{5}$/.test(zip);
  const invalid = {
    name: attempted && !name.trim(),
    street: attempted && !street.trim(),
    city: attempted && !city.trim(),
    state: attempted && !state.trim(),
    zip: attempted && !zipValid,
  };
  const formValid = name.trim() && street.trim() && city.trim() && state.trim() && zipValid;

  /**
   * PAY-1 — the order is written by the backend, which re-routes the basket
   * before persisting so the plan that ships is the plan that was quoted. The
   * confirmation waits for a real order id rather than inventing one.
   */
  async function placeOrder() {
    setAttempted(true);
    if (!formValid) return;
    try {
      const result = await place.mutateAsync({
        buyerId: DEMO_BUYER_ID,
        items: lines.map((l) => ({ listingId: l.listingId, quantity: l.qty })),
        destination: { street, city, state, zip },
      });
      setOrderId(result.orderId);
      setPlaced(true);
    } catch {
      // The mutation's error is rendered below; don't show a false confirmation.
    }
  }

  if (placed) {
    const parcelCountWord = parcels.length === 1 ? "parcel" : parcels.length === 2 ? "two parcels" : `${parcels.length} parcels`;
    return (
      <div className="confirm">
        <div className="seal">
          <div className="ring" />
          <div className="core">
            <CheckIcon strokeWidth={2.2} />
          </div>
        </div>

        <div className="eyebrow">Order placed</div>
        <h1>Your order is on its way</h1>
        <p className="lede">
          Thank you{name.trim() ? `, ${name.trim().split(" ")[0]}` : ""}. We&apos;re letting your sellers know to pack with care.
        </p>
        <div className="ordid">Order № {orderId}</div>

        {/*
          CART-6 carried through to confirmation: the same parcel-and-date
          breakdown agreed to at checkout, derived from cart state rather than
          the export's hardcoded two-parcel demo.
        */}
        <div className="timeline">
          <div className="tl-t">Your {parcelCountWord}</div>
          <div className="tl">
            <div className="step done">
              <div className="lbl">Order confirmed</div>
              <div className="sub">Just now · sellers notified</div>
            </div>
            {parcels.map((parcel) => (
              <div className="step" key={parcel.key}>
                <div className="lbl">
                  Parcel from {parcel.originMetro.split(",")[0]}
                  {parcel.temperature === "perishable" ? " · chilled" : ""}
                </div>
                <div className="sub">
                  Arrives <b>{dayShort(parcel.arrivesInDays)}</b>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="expect">
          <ClockIcon />
          <p>
            We&apos;ll email tracking for each parcel as it ships. <b>One order, one total</b> —{" "}
            {parcels.length === 1
              ? "your parcel is on its way from one seller."
              : `the ${parcels.length === 2 ? "two" : parcels.length} packages simply travel from different sellers.`}
          </p>
        </div>

        <div className="nudge">
          <div className="m">
            <h4 className="serif">Keep your orders in one place</h4>
            <p>Create an account to track deliveries and reorder your staples.</p>
          </div>
          <button type="button" className="b" onClick={() => router.push("/account")}>
            Create
          </button>
        </div>

        <div className="done">
          <button type="button" className="doneb" onClick={() => router.push("/orders")}>
            Track my order
          </button>
          <button type="button" className="track" onClick={() => router.push("/")}>
            Back to home
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/cart" eyebrow="Checkout" title="Almost there" />
      </div>

      <div className="cart-layout">
        <div className="checkoutMain">
          <CheckoutSection step={1} title="Where it's going">
            <FormField label="Full name" value={name} onChange={setName} placeholder="Adaeze Okafor"
              invalid={invalid.name} message="Please enter your name" />
            <FormField label="Street address" value={street} onChange={setStreet} placeholder="1200 Heritage Lane"
              invalid={invalid.street} message="Please enter your address" />
            <div className="row2">
              <FormField label="City" value={city} onChange={setCity} placeholder="Houston"
                invalid={invalid.city} message="Required" />
              <FormField label="State" value={state} onChange={setState} placeholder="TX" maxLength={2}
                invalid={invalid.state} message="Req." />
            </div>
            <FormField label="ZIP code" value={zip} onChange={setZip} placeholder="77002" inputMode="numeric" maxLength={5}
              invalid={invalid.zip} message="Enter a 5-digit ZIP"
              right={zipValid ? <span className="ok"><CheckIcon /> Serviced</span> : undefined} />
          </CheckoutSection>

          {/* CART-6 — every parcel's arrival stated before payment. */}
          <CheckoutSection step={2} title="When it arrives">
            <div className="arrlist">
              {parcels.map((parcel) => (
                <div className="a" key={parcel.key}>
                  <div className="ic">
                    <TruckIcon />
                  </div>
                  <div className="m">
                    <div className="t">
                      From {parcel.originMetro.split(",")[0]}
                      {parcel.temperature === "perishable" ? " · chilled" : ""}
                    </div>
                    <div className="s">
                      {parcel.lines.length} {parcel.lines.length === 1 ? "item" : "items"} · one blended shipping rate
                    </div>
                  </div>
                  <div className="d">{dayShort(parcel.arrivesInDays)}</div>
                </div>
              ))}
            </div>
          </CheckoutSection>

          <CheckoutSection step={3} title="How you're paying">
            <div className="wallets">
              {(["Apple Pay", "Google Pay"] as const).map((w) => (
                <button key={w} type="button" className={`wallet${wallet === w ? " on" : ""}`} onClick={() => setWallet(w)}>
                  {w}
                </button>
              ))}
            </div>
            <div className="paytabs">
              {([["card", "Credit or debit card"], ["paypal", "PayPal"]] as const).map(([key, label]) => (
                <button key={key} type="button" className={`payopt${pay === key ? " on" : ""}`} onClick={() => setPay(key)}>
                  <div className="r">
                    <span className="radio" />
                    <span className="lbl">{label}</span>
                  </div>
                </button>
              ))}
            </div>
          </CheckoutSection>
        </div>

        <div className="checkoutRail">
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
            <BigButton onClick={placeOrder}>
              {place.isPending ? "Placing your order…" : `Pay ${money(totalCents)}`}
            </BigButton>
            {place.isError && (
              <p className="payerr" role="alert">
                We couldn&apos;t place that order — {place.error.message}
              </p>
            )}
            <div className="trust">
              <LockIcon /> Encrypted payment · money-back freshness guarantee
            </div>
          </div>
        </div>
      </div>

      <div className="cart-spacer" />

      <ActionBar summaryLeft="Total" summaryRight={<b>{money(totalCents)}</b>} trust="Encrypted payment">
        <BigButton onClick={placeOrder}>Pay {money(totalCents)}</BigButton>
      </ActionBar>
    </>
  );
}
