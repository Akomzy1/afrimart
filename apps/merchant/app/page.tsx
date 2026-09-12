"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import {
  ProductGlyph,
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowRightIcon,
  CartIcon,
  CookPotIcon,
  MicIcon,
  ShipCheckIcon,
  LogoMark,
} from "@afrimart/ui";
import { trpc } from "@afrimart/api-client";
import { MESSAGES, glyphForCategory, type MerchantOrder } from "./orders";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Exactly three surfaces. Adding a fourth is a product decision, not a UI one. */
type Tab = "camera" | "orders" | "messages";

/**
 * AfriMart Merchant.html — the three-tab shell, order inbox and fulfilment flow.
 *
 * Deliberately absent, per CLAUDE.md's merchant-simplicity principle and the
 * prototype: any settings screen, any dashboard, any fourth navigation item.
 * The export also carries `v-earnings` and `v-catalogue` views; both are extra
 * surfaces beyond the three and are not built here.
 *
 * The 2026-09-10 re-export changed how those two are reached, not whether they
 * exist: it drops the overflow menu sheet entirely, moves earnings to a header
 * button showing a running total on the orders view, and retitles catalogue to
 * "What's listed", reached from the camera screen. Both destinations are still
 * outside the three surfaces, so this build is unaffected — but the header
 * earnings total is a new always-visible affordance, and adding it is a product
 * call rather than a UI one. Flagged, not built.
 */
export default function MerchantApp() {
  // useSearchParams opts the tree into client rendering, which the static
  // export needs a boundary for. The fallback is the shell, not a spinner —
  // a merchant on a slow phone should see furniture, not a blank screen.
  return (
    <Suspense fallback={<div className="mr-shell" />}>
      <MerchantAppInner />
    </Suspense>
  );
}

function MerchantAppInner() {
  const [tab, setTab] = useState<Tab>("orders");
  const [openId, setOpenId] = useState<string | null>(null);

  /**
   * There is no merchant sign-in yet. Rather than add a store picker — which
   * would be a fourth surface the prototype doesn't have — the store comes from
   * `?store=<id>`, defaulting to the first live one. Replace with the session's
   * store when auth lands; every query below is already scoped by it.
   */
  const params = useSearchParams();
  const storesQuery = trpc.merchant.stores.useQuery();
  const storeId = params.get("store") ?? storesQuery.data?.[0]?.id ?? "";
  const store = storesQuery.data?.find((s) => s.id === storeId) ?? storesQuery.data?.[0];

  const inbox = trpc.merchant.inbox.useQuery({ storeId }, { enabled: Boolean(storeId) });
  const utils = trpc.useUtils();
  const acceptJob = trpc.merchant.accept.useMutation({
    onSuccess: () => utils.merchant.inbox.invalidate(),
  });
  const shipJob = trpc.merchant.markShipped.useMutation({
    onSuccess: () => utils.merchant.inbox.invalidate(),
  });

  /**
   * Which items the merchant has ticked off, and how far through the flow they
   * are. Deliberately client-side: the backend models a shipment's status, not
   * a half-finished packing session, and a tick is not worth a round trip.
   */
  const [packedBy, setPackedBy] = useState<Record<string, number[]>>({});
  const [stepBy, setStepBy] = useState<Record<string, number>>({});

  const orders: MerchantOrder[] = (inbox.data ?? []).map((s) => ({
    id: s.shipmentId,
    ref: s.orderRef,
    buyer: s.buyer,
    ago: s.ago,
    status: s.status,
    step: stepBy[s.shipmentId] ?? 0,
    packed: packedBy[s.shipmentId] ?? [],
    valueCents: s.valueCents,
    temperatureClass: s.temperatureClass,
    items: s.items.map((i) => ({ name: i.name, qty: i.qty, glyph: glyphForCategory(i.category) })),
  }));

  const open = orders.find((o) => o.id === openId) ?? null;
  const newCount = orders.filter((o) => o.status === "new").length;
  const unread = MESSAGES.filter((m) => m.unread).length;

  function update(id: string, patch: Partial<MerchantOrder>) {
    if (patch.step !== undefined) setStepBy((prev) => ({ ...prev, [id]: patch.step as number }));
    if (patch.status === "packing") acceptJob.mutate({ shipmentId: id });
    if (patch.status === "ready") shipJob.mutate({ shipmentId: id });
  }

  /**
   * Derived from the previous state, not the render closure: a merchant tapping
   * items quickly fires several of these in one tick, and reading `packed`
   * from the closure would make each tap overwrite the last.
   */
  function togglePacked(id: string, index: number) {
    setPackedBy((prev) => {
      const current = prev[id] ?? [];
      return {
        ...prev,
        [id]: current.includes(index) ? current.filter((i) => i !== index) : [...current, index],
      };
    });
  }

  // ---- order detail / fulfilment ----
  if (open) {
    const itemCount = open.items.reduce((n, i) => n + i.qty, 0);
    const allPacked = open.packed.length === open.items.length;

    return (
      <div className="mr-shell">
        <div className="mr-header">
          <button type="button" className="back" onClick={() => setOpenId(null)} aria-label="Back to orders">
            <ChevronLeftIcon />
          </button>
          <h2 className="serif">Order {open.ref}</h2>
        </div>

        <div className="mr-scroll">
          <div className="mr-summary">
            <div className="l">
              <div className="k">{open.status === "new" ? "New order" : "Packing"}</div>
              <div className="buyer">{open.buyer}</div>
              <div className="items">
                {itemCount} items · {open.ref}
              </div>
            </div>
            <div className="r">
              <div className="val tnum">{money(open.valueCents)}</div>
            </div>
          </div>

          {open.status === "new" ? (
            <>
              <div className="mr-acceptnote">
                <p className="eyebrow">One order</p>
                <h3 className="serif">{itemCount} items to pack</h3>
                <p>Accept to start — we&apos;ll prepare the label.</p>
              </div>
              <div className="mr-itemlist">
                {open.items.map((item) => (
                  <div className="il" key={item.name}>
                    <div className="th">
                      <ProductGlyph kind={item.glyph} />
                    </div>
                    <div className="nm">{item.name}</div>
                    <div className="qty tnum">×{item.qty}</div>
                  </div>
                ))}
              </div>
            </>
          ) : (
            <>
              <div className="mr-progress">
                <div className="p on" />
                <div className={`p${open.step >= 1 ? " on" : ""}`} />
                <div className="p" />
              </div>
              <div className="mr-progress-lbl">
                {open.step === 0 ? "Step 1 — print the label" : "Step 2 — pack every item"}
              </div>
              <div className="mr-packhead">
                <h3 className="serif">Photo packing list</h3>
                <p>Tap each item as it goes in the box.</p>
              </div>
              <div className="mr-tiles">
                {open.items.map((item, i) => (
                  <button
                    key={item.name}
                    type="button"
                    className={`mr-tile${open.packed.includes(i) ? " on" : ""}`}
                    onClick={() => togglePacked(open.id, i)}
                    aria-pressed={open.packed.includes(i)}
                  >
                    <div className="pic">
                      <ProductGlyph kind={item.glyph} />
                    </div>
                    <div className="b">
                      <div className="nm">{item.name}</div>
                      <div className="qty tnum">Pack ×{item.qty}</div>
                    </div>
                    <span className="chk">
                      <CheckIcon strokeWidth={2.6} />
                    </span>
                  </button>
                ))}
              </div>
            </>
          )}
          <div className="mr-spacer" />
        </div>

        <div className="mr-actionbar">
          {open.status === "new" ? (
            <>
              <button
                type="button"
                className="mr-bigbtn accent"
                onClick={() => update(open.id, { status: "packing", step: 0 })}
              >
                <CheckIcon strokeWidth={2.6} /> Accept order
              </button>
              <div className="mr-barhint">{open.ago} · {itemCount} items</div>
            </>
          ) : open.step === 0 ? (
            <>
              <button type="button" className="mr-bigbtn green" onClick={() => update(open.id, { step: 1 })}>
                <ShipCheckIcon /> Print the label
              </button>
              <div className="mr-barhint">We&apos;ve already filled in the address</div>
            </>
          ) : (
            <>
              <button
                type="button"
                className={`mr-bigbtn ${allPacked ? "accent" : "disabled"}`}
                /* A real disabled attribute, not just pointer-events:none — the
                   CSS alone leaves the action reachable by keyboard and script. */
                disabled={!allPacked}
                onClick={() => {
                  update(open.id, { status: "ready" });
                  setOpenId(null);
                }}
              >
                <CheckIcon strokeWidth={2.6} /> Packed — ready for pickup
              </button>
              <div className="mr-barhint">
                {open.packed.length} of {open.items.length} items packed
              </div>
            </>
          )}
        </div>
      </div>
    );
  }

  // ---- three-tab shell ----
  return (
    <div className="mr-shell">
      <div className="mr-header">
        <div className="brand">
          <div className="wm">
            <LogoMark tone="on-light" size={22} />
            {/* The wordmark needs its own element: .wm is a flex row, so bare
                text would become a flex item and the gap would split the name. */}
            <span className="word">
              Afri<span className="m">Mart</span>
            </span>
            <span className="tag">Seller</span>
          </div>
          <div className="store">{store ? `${store.name} · ${store.metro.split(",")[0]}` : " "}</div>
        </div>
      </div>

      <div className="mr-scroll">
        {tab === "orders" && <OrdersInbox orders={orders} onOpen={setOpenId} onAccept={(id) => update(id, { status: "packing", step: 0 })} />}
        {tab === "camera" && <CameraSurface />}
        {tab === "messages" && <MessagesSurface />}
        <div className="mr-spacer" />
      </div>

      <nav className="mr-tabbar">
        <button type="button" className={`mr-tab${tab === "camera" ? " on" : ""}`} onClick={() => setTab("camera")}>
          <CookPotIcon />
          <span className="t">Camera</span>
        </button>
        <button type="button" className={`mr-tab${tab === "orders" ? " on" : ""}`} onClick={() => setTab("orders")}>
          {newCount > 0 && <span className="badge">{newCount}</span>}
          <CartIcon />
          <span className="t">Orders</span>
        </button>
        <button type="button" className={`mr-tab${tab === "messages" ? " on" : ""}`} onClick={() => setTab("messages")}>
          {unread > 0 && <span className="badge">{unread}</span>}
          <MicIcon />
          <span className="t">Messages</span>
        </button>
      </nav>
    </div>
  );
}

function OrdersInbox({
  orders, onOpen, onAccept,
}: { orders: MerchantOrder[]; onOpen: (id: string) => void; onAccept: (id: string) => void }) {
  const fresh = orders.filter((o) => o.status === "new");
  const working = orders.filter((o) => o.status === "packing");
  const done = orders.filter((o) => o.status === "ready");

  return (
    <>
      {fresh.length > 0 && (
        <>
          <div className="mr-sectitle">
            <span className="eyebrow">New</span>
            <span className="n">{fresh.length}</span>
          </div>
          {fresh.map((o) => (
            <div className="mr-ordcard new" key={o.id}>
              <button type="button" className="oc-top" onClick={() => onOpen(o.id)}>
                <div className="oc-l">
                  <div className="num">{o.ref}</div>
                  <div className="meta">{o.items.reduce((n, i) => n + i.qty, 0)} items</div>
                  <div className="buyer">{o.buyer}</div>
                </div>
                <div className="oc-r">
                  <div className="val tnum">{money(o.valueCents)}</div>
                  <div className="ago">{o.ago}</div>
                </div>
              </button>
              <button type="button" className="accept" onClick={() => onAccept(o.id)}>
                <CheckIcon strokeWidth={2.6} /> Accept
              </button>
            </div>
          ))}
        </>
      )}

      {working.length > 0 && (
        <>
          <div className="mr-sectitle">
            <span className="eyebrow">Packing</span>
          </div>
          {working.map((o) => (
            <div className="mr-ordcard" key={o.id}>
              <button type="button" className="oc-top" onClick={() => onOpen(o.id)}>
                <div className="oc-l">
                  <div className="num">{o.ref}</div>
                  <div className="meta">{o.items.reduce((n, i) => n + i.qty, 0)} items</div>
                  <div className="buyer">{o.buyer}</div>
                </div>
                <div className="oc-r">
                  <div className="val tnum">{money(o.valueCents)}</div>
                  <div className="ago">{o.ago}</div>
                </div>
              </button>
              <button type="button" className="status-row" onClick={() => onOpen(o.id)}>
                <span className="pill">
                  <ShipCheckIcon /> {o.packed.length} of {o.items.length} packed
                </span>
                <span className="go">
                  Continue <ChevronRightIcon />
                </span>
              </button>
            </div>
          ))}
        </>
      )}

      {done.length > 0 && (
        <>
          <div className="mr-sectitle">
            <span className="eyebrow">Ready for pickup</span>
          </div>
          {done.map((o) => (
            <div className="mr-ordcard" key={o.id}>
              <button type="button" className="oc-top" onClick={() => onOpen(o.id)}>
                <div className="oc-l">
                  <div className="num">{o.ref}</div>
                  <div className="meta">Packed · label printed</div>
                  <div className="buyer">{o.buyer}</div>
                </div>
                <div className="oc-r">
                  <div className="val tnum">{money(o.valueCents)}</div>
                </div>
              </button>
            </div>
          ))}
        </>
      )}

      {orders.length === 0 && (
        <div className="mr-empty">
          <h3 className="serif">No orders yet today</h3>
          <p>We&apos;ll buzz you the moment one lands.</p>
        </div>
      )}
    </>
  );
}

/** MCH-1/ONB-2 — photo and voice first, words second. */
function CameraSurface() {
  return (
    <div className="mr-cam">
      <div className="mr-cam-prompt">What changed today?</div>
      <button type="button" className="mr-bigaction stock">
        <span className="ic">
          <CookPotIcon />
        </span>
        <span className="m">
          <span className="t">New stock arrived</span>
          <span className="s">Snap the delivery — we&apos;ll update your quantities.</span>
        </span>
        <span className="arr">
          <ArrowRightIcon />
        </span>
      </button>
      <button type="button" className="mr-bigaction avail">
        <span className="ic">
          <MicIcon />
        </span>
        <span className="m">
          <span className="t">Update availability</span>
          <span className="s">Hold to talk — &ldquo;ogbono finished till Friday&rdquo;.</span>
        </span>
        <span className="arr">
          <ArrowRightIcon />
        </span>
      </button>
      <div className="mr-cam-foot">Photo first. We&apos;ll handle the words.</div>
    </div>
  );
}

function MessagesSurface() {
  return (
    <div className="mr-msglist">
      {MESSAGES.map((m) => (
        <button type="button" className="mr-msgrow" key={m.id}>
          <span className="av">{m.initial}</span>
          <span className="m">
            <span className="nm">{m.from}</span>
            <span className="snippet">{m.snippet}</span>
          </span>
          <span className="when">{m.when}</span>
          {m.unread && <span className="unread" />}
        </button>
      ))}
    </div>
  );
}
