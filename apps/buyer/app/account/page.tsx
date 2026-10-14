"use client";

import { useState } from "react";
import Link from "next/link";
import { trpc } from "@afrimart/api-client";
import { glyphForCategory } from "../../lib/glyph";
import { tokenStore } from "../providers";
import {
  PageHeader,
  ProductGlyph,
  ChevronRightIcon,
  LocationIcon,
  CartIcon,
  TruckIcon,
  SealIcon,
  AccountIcon,
  useToast,
  type ProductGlyphKind,
} from "@afrimart/ui";
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** "Buy it again" — the buyer's usuals, from the prototype's demo set. */
const USUALS: { name: string; seller: string; priceCents: number; glyph: ProductGlyphKind }[] = [
  { name: "Egusi", seller: "Adunni Foods", priceCents: 850, glyph: "leaf" },
  { name: "Red Palm Oil", seller: "Mama Ngozi", priceCents: 1530, glyph: "jar" },
  { name: "Garri", seller: "Kwame & Sons", priceCents: 1200, glyph: "wheat" },
  { name: "Ata Rodo", seller: "Lagos Fresh", priceCents: 675, glyph: "pepper" },
];

const dayWord = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });

/**
 * AfriMart Buyer - Boxes Tracking and Account.html — account view.
 * Order history is the signed-in buyer's real orders (QC-3 reports hang off
 * them). There is no account router on the backend yet, so the profile and the
 * usuals below are still the prototype's demo data. The Taste of Home
 * row links nowhere on purpose: boxes are PRD SUB-1, Phase 2, unbuilt.
 */
export default function AccountPage() {
  const { show } = useToast();
  const [added, setAdded] = useState<string | null>(null);
  const orders = trpc.orders.list.useQuery();
  const me = trpc.userAuth.buyerMe.useQuery();
  // Ending the session on the server first, then forgetting it here either way.
  const signOut = trpc.userAuth.signOut.useMutation({ onSettled: () => tokenStore.set(null) });

  /**
   * SRCH-4 one-tap reorder. The orders API now exists, so the lines are
   * there to reorder from, but the cart's add-by-listing path is not wired to
   * past orders yet; until it is, say so plainly rather than fake an add.
   */
  function reorder(id: string, ref: string) {
    setAdded(id);
    show(`Reordering ${ref} is coming soon`);
    window.setTimeout(() => setAdded(null), 2000);
  }

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/" eyebrow="Account" title="Your kitchen" />
      </div>

      <div className="acct-layout">
        <div className="acct-top">
          <div className="av">{me.data ? me.data.email.charAt(0).toUpperCase() : ""}</div>
          <div className="m">
            <div className="nm">{me.data?.email ?? " "}</div>
            <div className="s">
              <button type="button" className="bsi-link" onClick={() => signOut.mutate()} disabled={signOut.isPending}>
                Sign out
              </button>
            </div>
          </div>
        </div>

        <div className="reorder">
          <div className="rh">
            <h3 className="serif">Buy it again</h3>
            <span className="eyebrow">Your usuals</span>
          </div>
          <div className="rail">
            {USUALS.map((u) => (
              <div className="rcard" key={u.name}>
                <div className="shot">
                  <ProductGlyph kind={u.glyph} />
                </div>
                <div className="b">
                  <div className="nm">{u.name}</div>
                  <div className="meta">{u.seller}</div>
                  <div className="price tnum">{money(u.priceCents)}</div>
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="history">
          <h3 className="serif">Order history</h3>
          {orders.isLoading && <p className="od-note">Loading your orders…</p>}
          {orders.data && orders.data.length === 0 && <p className="od-note">No orders yet. When you place one, it shows up here.</p>}
          {orders.data?.map((order) => {
            const items = order.parcels.flatMap((p) => p.items);
            const delivered = order.parcels.every((p) => p.status === "delivered");
            const openReports = order.parcels.flatMap((p) => p.claims).filter((c) => c.stage === "review").length;
            const glyphs = items.slice(0, 4).map((i) => glyphForCategory(i.category));
            const count = items.reduce((n, i) => n + i.quantity, 0);
            return (
              <div className="ord" key={order.orderId}>
                <div className="top">
                  <div className="d">
                    {dayWord(order.placedAt)}
                    <span className="sub">Order № {order.ref}</span>
                  </div>
                  <div className={`st ${delivered ? "done" : "transit"}`}>{delivered ? "Delivered" : "On the way"}</div>
                </div>
                <div className="thumbs">
                  {glyphs.map((g, i) => (
                    <div className="t" key={i}>
                      <ProductGlyph kind={g} />
                    </div>
                  ))}
                  {items.length > glyphs.length && <div className="more">+{items.length - glyphs.length}</div>}
                </div>
                {openReports > 0 && (
                  <span className="cchip open">
                    {openReports === 1 ? "Report under review" : `${openReports} reports under review`}
                  </span>
                )}
                <div className="foot">
                  <div className="tt">
                    {count} {count === 1 ? "item" : "items"} · <b>{money(order.totalCents)}</b>
                  </div>
                  <div className="ord-actions">
                    {!delivered && (
                      <Link href="/orders" className="track">
                        Track order
                      </Link>
                    )}
                    <Link href={`/account/orders/${order.orderId}`} className="track">
                      View order
                    </Link>
                    {delivered && (
                      <button type="button" className={`re${added === order.orderId ? " added" : ""}`} onClick={() => reorder(order.orderId, order.ref)}>
                        <CartIcon /> {added === order.orderId ? "Added" : "Reorder"}
                      </button>
                    )}
                  </div>
                </div>
              </div>
            );
          })}
        </div>

        <div className="rows">
          {/* Taste of Home boxes are PRD SUB-1 (Phase 2) and deliberately unbuilt. */}
          <button type="button" className="arow" disabled title="Coming in a later phase">
            <span className="ic">
              <SealIcon />
            </span>
            <span className="m">
              <span className="t">Taste of Home boxes</span>
              <span className="s">Coming soon</span>
            </span>
            <span className="ch">
              <ChevronRightIcon />
            </span>
          </button>
          <button type="button" className="arow">
            <span className="ic">
              <LocationIcon />
            </span>
            <span className="m">
              <span className="t">Addresses</span>
              <span className="s">2 saved · Home, Work</span>
            </span>
            <span className="ch">
              <ChevronRightIcon />
            </span>
          </button>
          <button type="button" className="arow">
            <span className="ic">
              <TruckIcon />
            </span>
            <span className="m">
              <span className="t">Delivery preferences</span>
              <span className="s">Notifications and drop-off notes</span>
            </span>
            <span className="ch">
              <ChevronRightIcon />
            </span>
          </button>
          <button type="button" className="arow">
            <span className="ic">
              <AccountIcon />
            </span>
            <span className="m">
              <span className="t">Profile and sign-in</span>
              <span className="s">Name, email, password</span>
            </span>
            <span className="ch">
              <ChevronRightIcon />
            </span>
          </button>
        </div>

        <div className="cart-spacer" />
      </div>
    </>
  );
}
