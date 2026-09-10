"use client";

import { useState } from "react";
import Link from "next/link";
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

interface HistoryOrder {
  id: string;
  date: string;
  glyphs: ProductGlyphKind[];
  itemCount: number;
  totalCents: number;
  status: "transit" | "done";
  statusLabel: string;
}

const HISTORY: HistoryOrder[] = [
  { id: "AM-4827-193", date: "This Tuesday", glyphs: ["leaf", "pepper", "jar", "leaf"], itemCount: 5, totalCents: 9920, status: "transit", statusLabel: "On the way" },
  { id: "AM-4790-021", date: "2 weeks ago", glyphs: ["wheat", "seed", "jar"], itemCount: 6, totalCents: 7460, status: "done", statusLabel: "Delivered" },
  { id: "AM-4712-508", date: "Last month", glyphs: ["leaf", "pepper"], itemCount: 4, totalCents: 4130, status: "done", statusLabel: "Delivered" },
];

/**
 * AfriMart Buyer - Boxes Tracking and Account.html — account view.
 * There is no auth or account router on the backend yet, so the profile,
 * usuals and history below are the prototype's demo data. The Taste of Home
 * row links nowhere on purpose: boxes are PRD SUB-1, Phase 2, unbuilt.
 */
export default function AccountPage() {
  const { show } = useToast();
  const [added, setAdded] = useState<string | null>(null);

  /**
   * SRCH-4 one-tap reorder, as far as it can honestly go today: HISTORY is
   * local demo data carrying only glyphs and a count, and the backend exposes
   * no orders router, so there is nothing to resolve a past order's actual
   * lines from. Rather than fake an add, this tells the buyer plainly. Wire it
   * to real order lines once an orders API exists.
   */
  function reorder(order: HistoryOrder) {
    setAdded(order.id);
    show(`Reordering ${order.id} needs your order history — that's coming soon`);
    window.setTimeout(() => setAdded(null), 2000);
  }

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/" eyebrow="Account" title="Your kitchen" />
      </div>

      <div className="acct-layout">
        <div className="acct-top">
          <div className="av">A</div>
          <div className="m">
            <div className="nm">Amara Okafor</div>
            <div className="s">Houston, TX · member since 2024</div>
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
          {HISTORY.map((order) => (
            <div className="ord" key={order.id}>
              <div className="top">
                <div className="d">
                  {order.date}
                  <span className="sub">Order № {order.id}</span>
                </div>
                <div className={`st ${order.status}`}>{order.statusLabel}</div>
              </div>
              <div className="thumbs">
                {order.glyphs.map((g, i) => (
                  <div className="t" key={i}>
                    <ProductGlyph kind={g} />
                  </div>
                ))}
                {order.itemCount > order.glyphs.length && <div className="more">+{order.itemCount - order.glyphs.length}</div>}
              </div>
              <div className="foot">
                <div className="tt">
                  {order.itemCount} items · <b>{money(order.totalCents)}</b>
                </div>
                {order.status === "transit" ? (
                  <Link href="/orders" className="track">
                    Track order
                  </Link>
                ) : (
                  <button type="button" className={`re${added === order.id ? " added" : ""}`} onClick={() => reorder(order)}>
                    <CartIcon /> {added === order.id ? "Added" : "Reorder"}
                  </button>
                )}
              </div>
            </div>
          ))}
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
