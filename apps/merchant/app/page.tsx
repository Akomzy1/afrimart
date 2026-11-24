"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  CheckIcon,
  ChevronLeftIcon,
  ChevronRightIcon,
  ArrowRightIcon,
  CartIcon,
  CookPotIcon,
  MicIcon,
  ShipCheckIcon,
  CameraIcon,
  LogoMark,
} from "@afrimart/ui";
import { trpc } from "@afrimart/api-client";
import { glyphForCategory, type MerchantOrder } from "./orders";
import { ListingPhoto } from "./ListingPhoto";
import { ReprintLabel, ShippingLabel } from "./ShippingLabel";
import { photoUrl } from "./providers";
import { SignIn } from "./SignIn";
import { BOX_PHOTO, PhotoCamera } from "./PhotoCamera";
import { SupportThread } from "./SupportThread";
import { WhatsListed } from "./WhatsListed";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Exactly three surfaces. Adding a fourth is a product decision, not a UI one. */
type Tab = "camera" | "orders" | "messages";

/**
 * AfriMart Merchant.html — the three-tab shell, order inbox and fulfilment flow.
 *
 * Deliberately absent, per CLAUDE.md's merchant-simplicity principle and the
 * prototype: any settings screen, any dashboard, any fourth navigation item.
 * The export also carries `v-earnings` and `v-catalogue` views. Catalogue, titled
 * "What's listed" and reached from the Camera tab, is built (WhatsListed.tsx)
 * because the QC-1 seller rules surface there: hidden listings, the paused
 * banner, the add-a-product checks. The AfriMart thread in Messages
 * (SupportThread.tsx) is where a seller applies for licensed-kitchen status or a
 * badge. Neither adds a fourth tab.
 *
 * Earnings is not built: it moves to a header button showing a running total on
 * the orders view, an always-visible affordance that is a product call rather
 * than a UI one. Flagged, not built.
 */
export default function MerchantApp() {
  const router = useRouter();
  // Signed in or not is whatever the server says when asked which shop this is:
  // the session is an httpOnly cookie this page cannot read. Until it has
  // answered, show the shell rather than flashing the sign-in screen at someone
  // who is signed in. Any later request that comes back UNAUTHORIZED refreshes
  // this answer (providers.tsx) and the sign-in screen takes over.
  const me = trpc.merchant.me.useQuery(undefined, { retry: false, staleTime: 60_000, refetchOnWindowFocus: true });
  useEffect(() => { if (me.data?.needsOnboarding) router.replace("/onboarding"); }, [me.data?.needsOnboarding, router]);
  if (me.data?.needsOnboarding) return <div className="mr-shell" />;
  if (me.isPending) return <div className="mr-shell" />;
  return me.data ? <MerchantAppInner /> : <SignIn />;
}

function MerchantAppInner() {
  const [tab, setTab] = useState<Tab>("orders");
  const [openId, setOpenId] = useState<string | null>(null);
  // Two screens reached from inside the tabs: What's listed (Camera) and the AfriMart thread (Messages).
  const [sub, setSub] = useState<"listed" | "support" | null>(null);

  // Which shop this is comes from the session the server holds, not from the page.
  const store = trpc.merchant.me.useQuery().data;
  const inbox = trpc.merchant.inbox.useQuery();
  const thread = trpc.merchant.thread.useQuery();
  const utils = trpc.useUtils();
  const acceptJob = trpc.merchant.accept.useMutation({
    onSettled: () => utils.merchant.inbox.invalidate(),
  });
  const shipJob = trpc.merchant.markShipped.useMutation({
    onSuccess: () => utils.merchant.inbox.invalidate(),
  });
  // QC-2 — which order the box-photo camera is open for, and the upload itself.
  const [cameraFor, setCameraFor] = useState<string | null>(null);
  const savePhoto = trpc.merchant.packingPhoto.useMutation({
    onSuccess: () => {
      utils.merchant.inbox.invalidate();
      setCameraFor(null);
    },
  });

  /**
   * Which items the merchant has ticked off, and how far through the flow they
   * are. Deliberately client-side: the backend models a shipment's status, not
   * a half-finished packing session, and a tick is not worth a round trip.
   */
  const [packedBy, setPackedBy] = useState<Record<string, string[]>>({});
  const [stepBy, setStepBy] = useState<Record<string, number>>({});

  const orders: MerchantOrder[] = (inbox.data ?? []).map((s) => ({
    id: s.shipmentId,
    ref: s.orderRef,
    buyer: s.buyer,
    ago: s.ago,
    status: s.status,
    declineReason: s.declineReason,
    pickup: s.pickup,
    step: stepBy[s.shipmentId] ?? 0,
    packed: packedBy[s.shipmentId] ?? [],
    valueCents: s.valueCents,
    temperatureClass: s.temperatureClass,
    items: s.items.map((i) => ({ ...i, glyph: glyphForCategory(i.category) })),
    photoUrl: s.packingPhotoUrl,
  }));

  const open = orders.find((o) => o.id === openId && o.status !== "declined") ?? null;
  const newCount = orders.filter((o) => o.status === "new").length;
  const unread = thread.data?.unread ?? 0;

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
  function togglePacked(id: string, itemId: string) {
    setPackedBy((prev) => {
      const current = prev[id] ?? [];
      return {
        ...prev,
        [id]: current.includes(itemId) ? current.filter((i) => i !== itemId) : [...current, itemId],
      };
    });
  }

  // ---- order detail / fulfilment ----
  if (open) {
    const itemCount = open.items.reduce((n, i) => n + i.qty, 0);
    const allPacked = open.packed.length === open.items.length;
    // QC-2 — the box is photographed open, after the last item is in and before it is sealed.
    const readyToShip = allPacked && open.photoUrl !== null;

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
              <div className="k">{open.status === "new" ? "New order" : open.status === "ready" ? "Ready for pickup" : "Packing"}</div>
              <div className="buyer">{open.buyer}</div>
              <div className="items">
                {itemCount} items · {open.ref}
              </div>
            </div>
            <div className="r">
              <div className="val tnum">{money(open.valueCents)}</div>
            </div>
          </div>

          {open.pickup && <PickupNotice pickup={open.pickup} />}
          {open.status === "new" || open.status === "ready" ? (
            <>
              {open.status === "new" && <div className="mr-acceptnote">
                <p className="eyebrow">One order</p>
                <h3 className="serif">{itemCount} items to pack</h3>
                <p>Accept to start — we&apos;ll prepare the label.</p>
              </div>}
              <div className="mr-itemlist">
                {open.items.map((item) => (
                  <div className="il" key={item.id}>
                    <div className="th">
                      <ListingPhoto src={item.productPhoto} glyph={item.glyph} />
                    </div>
                    <div className="nm">{item.name} <small>{item.packSize}</small></div>
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
                <div className={`p${open.step >= 1 && allPacked ? " on" : ""}`} />
              </div>
              <div className="mr-progress-lbl">
                {open.step === 0
                  ? "Step 1 — print the label"
                  : allPacked
                    ? "Step 3 — photo the open box"
                    : "Step 2 — pack every item"}
              </div>
              <div className="mr-packhead">
                <h3 className="serif">Photo packing list</h3>
                <p>Tap each item as it goes in the box.</p>
              </div>
              <div className="mr-tiles">
                {open.items.map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    className={`mr-tile${open.packed.includes(item.id) ? " on" : ""}`}
                    onClick={() => togglePacked(open.id, item.id)}
                    aria-pressed={open.packed.includes(item.id)}
                  >
                    <div className="pic">
                      <ListingPhoto src={item.productPhoto} glyph={item.glyph} />
                    </div>
                    <div className="b">
                      <div className="nm">{item.name}</div>
                      <div className="qty tnum">{item.packSize} · Pack ×{item.qty}</div>
                    </div>
                    <span className="chk">
                      <CheckIcon strokeWidth={2.6} />
                    </span>
                  </button>
                ))}
              </div>
              <div className="mr-packcount tnum">
                <b>{open.packed.length}</b> of {open.items.length} packed
              </div>
              <BoxPhotoSlot
                order={open}
                canPhotograph={allPacked && open.step >= 1}
                onOpen={() => {
                  savePhoto.reset();
                  setCameraFor(open.id);
                }}
              />
            </>
          )}
          <div className="mr-spacer" />
        </div>

        <div className="mr-actionbar">
          {open.status === "new" ? (
            <NewOrderActions key={open.id} order={open} accepting={acceptJob.isPending}
              onAccept={() => update(open.id, { status: "packing", step: 0 })} />
          ) : open.status === "ready" || open.step === 0 ? (
            <ShippingLabel key={open.id} shipmentId={open.id}
              onPrinted={open.status === "packing" ? () => update(open.id, { step: 1 }) : undefined} />
          ) : (
            <>
              <button
                type="button"
                className={`mr-bigbtn ${readyToShip ? "accent" : "disabled"}`}
                /* A real disabled attribute, not just pointer-events:none — the
                   CSS alone leaves the action reachable by keyboard and script.
                   The server refuses a shipment with no box photo as well. */
                disabled={!readyToShip || shipJob.isPending}
                onClick={() => {
                  update(open.id, { status: "ready" });
                  setOpenId(null);
                }}
              >
                <CheckIcon strokeWidth={2.6} /> Packed — ready for pickup
              </button>
              <div className="mr-barhint">
                {!allPacked
                  ? `${open.items.length - open.packed.length} still to pack`
                  : open.photoUrl === null
                    ? "Photograph the open box first"
                    : "Ready to hand over"}
              </div>
              <ReprintLabel key={open.id} shipmentId={open.id} />
            </>
          )}
        </div>

        {cameraFor === open.id && (
          <PhotoCamera
            copy={BOX_PHOTO(open.ref)}
            saving={savePhoto.isPending}
            error={savePhoto.isError ? savePhoto.error.message : null}
            onClose={() => setCameraFor(null)}
            onUse={(image) => savePhoto.mutate({ shipmentId: open.id, image })}
          />
        )}
      </div>
    );
  }

  // ---- screens reached from a tab ----
  if (sub === "listed") {
    return (
      <WhatsListed
        onBack={() => setSub(null)}
        onMessage={() => {
          setTab("messages");
          setSub("support");
        }}
      />
    );
  }
  if (sub === "support") {
    return <SupportThread onBack={() => setSub(null)} />;
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
        {tab === "camera" && <CameraSurface hasReview={Boolean(store?.hasShelfReview)} canFilm={Boolean(store?.canFilmShelves)} onListed={() => setSub("listed")} />}
        {tab === "messages" && (
          <MessagesSurface
            onSupport={() => setSub("support")}
            latest={thread.data?.messages.at(-1)?.body ?? null}
            unread={unread > 0}
          />
        )}
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

function GridIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} aria-hidden="true">
      <rect x="3" y="4" width="7" height="7" rx="1.5" />
      <rect x="14" y="4" width="7" height="7" rx="1.5" />
      <rect x="3" y="15" width="7" height="5" rx="1.5" />
      <rect x="14" y="15" width="7" height="5" rx="1.5" />
    </svg>
  );
}

/**
 * QC-2 — the box photo slot. Disabled until every item is ticked, amber and
 * tappable when it is time, a thumbnail with Retake once saved.
 */
function BoxPhotoSlot({
  order, canPhotograph, onOpen,
}: { order: MerchantOrder; canPhotograph: boolean; onOpen: () => void }) {
  if (order.photoUrl) {
    return (
      <div className="mr-bp done">
        <div className="thumb">
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={photoUrl(order.photoUrl)} alt="Your photo of the packed box" />
        </div>
        <div className="m">
          <span className="t">Box photo</span>
          <span className="s">
            <CheckIcon strokeWidth={2.6} /> Saved
          </span>
        </div>
        <button type="button" className="retake" onClick={onOpen}>
          Retake
        </button>
      </div>
    );
  }
  return (
    <button type="button" className={`mr-bp${canPhotograph ? " ready" : ""}`} disabled={!canPhotograph} onClick={onOpen}>
      <span className="ic">
        <CameraIcon />
      </span>
      <span className="m">
        <span className="t">{canPhotograph ? "Photograph the open box" : "Box photo"}</span>
        <span className="s">
          {canPhotograph ? "Before you seal it" : order.step >= 1 ? "After every item is in" : "After the label is printed"}
        </span>
      </span>
    </button>
  );
}

function PickupNotice({ pickup }: { pickup: NonNullable<MerchantOrder["pickup"]> }) {
  if (pickup.state === "cancelled") return <p className="mr-pickup">Pickup cancelled</p>;
  if (!pickup.windowStart || !pickup.windowEnd) return <p className="mr-pickup">Pickup pending · No carrier booking yet</p>;
  const format = new Intl.DateTimeFormat(undefined, {
    weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
  });
  return <p className="mr-pickup"><strong>Test pickup window</strong><br />
    {format.formatRange(new Date(pickup.windowStart), new Date(pickup.windowEnd))}</p>;
}

function NewOrderActions({ order, accepting, onAccept }: { order: MerchantOrder; accepting: boolean; onAccept: () => void }) {
  const [editing, setEditing] = useState(false);
  const [reason, setReason] = useState("");
  const utils = trpc.useUtils();
  const decline = trpc.merchant.decline.useMutation({ onSettled: () => utils.merchant.inbox.invalidate() });
  if (editing) {
    return (
      <form className="mr-decline" onSubmit={(e) => {
        e.preventDefault();
        if (reason.trim() && !decline.isPending) decline.mutate({ shipmentId: order.id, reason: reason.trim() });
      }}>
        <label htmlFor="decline-reason">Why are you declining this order?</label>
        <textarea id="decline-reason" autoFocus required maxLength={500} rows={2} value={reason}
          onChange={(e) => setReason(e.target.value)} disabled={decline.isPending} />
        {decline.isError && <p role="alert">{decline.error.message}</p>}
        <button className="mr-bigbtn accent" disabled={!reason.trim() || decline.isPending}>
          {decline.isPending ? "Saving…" : "Confirm decline"}
        </button>
        <button type="button" className="mr-secondary" disabled={decline.isPending} onClick={() => {
          setEditing(false); setReason(""); decline.reset();
        }}>Keep order</button>
      </form>
    );
  }
  return <>
    <button type="button" className="mr-bigbtn accent" disabled={accepting} onClick={onAccept}>
      <CheckIcon strokeWidth={2.6} /> Accept order
    </button>
    <button type="button" className="mr-secondary" disabled={accepting} onClick={() => setEditing(true)}>Decline order</button>
  </>;
}

function OrdersInbox({
  orders, onOpen, onAccept,
}: { orders: MerchantOrder[]; onOpen: (id: string) => void; onAccept: (id: string) => void }) {
  const fresh = orders.filter((o) => o.status === "new");
  const working = orders.filter((o) => o.status === "packing");
  const done = orders.filter((o) => o.status === "ready");
  const declined = orders.filter((o) => o.status === "declined");

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

      {declined.length > 0 && (
        <>
          <div className="mr-sectitle"><span className="eyebrow">Declined</span></div>
          {declined.map((o) => (
            <div className="mr-ordcard" key={o.id}>
              <div className="oc-top"><div className="oc-l">
                <div className="num">{o.ref}</div>
                <div className="meta mr-reason">{o.declineReason}</div>
              </div></div>
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
function CameraSurface({ hasReview, canFilm, onListed }: { hasReview: boolean; canFilm: boolean; onListed: () => void }) {
  return (
    <div className="mr-cam">
      <div className="mr-cam-prompt">What changed today?</div>
      {hasReview && <Link className="mr-bigaction stock" href="/onboarding/review"><span className="ic"><CameraIcon /></span><span className="m"><span className="t">Review catalogue</span><span className="s">Check the products from your shelves.</span></span><span className="arr"><ArrowRightIcon /></span></Link>}
      {canFilm && !hasReview && <Link className="mr-bigaction stock" href="/onboarding/shelves"><span className="ic"><CameraIcon /></span><span className="m"><span className="t">Film your shelves</span><span className="s">Capture or revisit your shelf photos.</span></span><span className="arr"><ArrowRightIcon /></span></Link>}
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
      <button type="button" className="mr-bigaction listed" onClick={onListed}>
        <span className="ic">
          <GridIcon />
        </span>
        <span className="m">
          <span className="t">What&apos;s listed</span>
          <span className="s">Tap to fix a price, mark one out, or add a product.</span>
        </span>
        <span className="arr">
          <ArrowRightIcon />
        </span>
      </button>
      <div className="mr-cam-foot">Photo first. We&apos;ll handle the words.</div>
    </div>
  );
}

/**
 * The only conversation there is today is with AfriMart: payouts as they are
 * made, and applying for licensed-kitchen status or a badge. Buyer-to-seller
 * messages are not built, and the prototype's sample conversations (invented
 * customers) are not shown to a real seller.
 */
function MessagesSurface({
  onSupport, latest, unread,
}: { onSupport: () => void; latest: string | null; unread: boolean }) {
  return (
    <div className="mr-msglist">
      <button type="button" className="mr-msgrow support" onClick={onSupport}>
        <span className="av">AM</span>
        <span className="m">
          <span className="nm">AfriMart</span>
          <span className="snippet">{latest ?? "Chilled food or a badge? Apply here."}</span>
        </span>
        {unread && <span className="unread" />}
      </button>
    </div>
  );
}
