"use client";

import { useState, type ReactNode } from "react";
import { trpc, type RouterOutputs } from "@afrimart/api-client";
import { CameraIcon, CheckIcon, ChevronLeftIcon, CloseIcon, PlusIcon, ProductGlyph, type ProductGlyphKind } from "@afrimart/ui";
import { glyphForCategory } from "./orders";

/**
 * "What's listed" — AfriMart Merchant.html, reached from the Camera tab.
 *
 * The products the store has up, a banner when some are hidden and why, a sheet
 * to fix a price or mark one out, and a sheet to add one. For home-based and
 * aspiring sellers the add sheet is where the QC-1 rules meet the seller: a
 * paused category, cold food without a licensed kitchen, and the one-time permit
 * confirmation each stop the flow with a plain explanation.
 *
 * Nothing here decides what is allowed. Which listings are hidden comes from the
 * server (the same filter buyers' reads go through), and the add sheet's checks
 * repeat what the server enforces so the seller is told early, not refused late.
 */

type Listing = RouterOutputs["merchant"]["listings"][number];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

function glyphFor(l: Listing): ProductGlyphKind {
  switch (l.controlledCategory) {
    case "meat":
      return "meat";
    case "poultry":
      return "bird";
    case "fish":
      return "fish";
    case "dairy":
      return "milk";
    default:
      return glyphForCategory(l.category);
  }
}

/** What a seller can start a listing from (the prototype's six tiles). */
const ADD_CATEGORIES = [
  { label: "Dry goods", glyph: "wheat", controlled: null },
  { label: "Spices & oils", glyph: "pepper", controlled: null },
  { label: "Meat", glyph: "meat", controlled: "meat" },
  { label: "Poultry", glyph: "bird", controlled: "poultry" },
  { label: "Fish", glyph: "fish", controlled: "fish" },
  { label: "Dairy", glyph: "milk", controlled: "dairy" },
] as const satisfies readonly { label: string; glyph: ProductGlyphKind; controlled: "meat" | "poultry" | "fish" | "dairy" | null }[];

type AddCategory = (typeof ADD_CATEGORIES)[number];

const STORAGE = [
  { label: "Room temperature", sub: "Shelf or pantry", cold: false },
  { label: "Chilled", sub: "Fridge", cold: true },
  { label: "Frozen", sub: "Freezer", cold: true },
] as const;

function Svg({ children, width = 1.7 }: { children: ReactNode; width?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={width} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}
const PauseIcon = () => (
  <Svg width={2.4}>
    <path d="M9 5v14M15 5v14" />
  </Svg>
);
const SnowIcon = () => (
  <Svg width={1.6}>
    <path d="M12 2v20M4 7l16 10M20 7L4 17" />
  </Svg>
);
const ShieldIcon = () => (
  <Svg width={1.6}>
    <path d="M12 3l8 3v6c0 5-3.5 8-8 9-4.5-1-8-4-8-9V6l8-3zM8.5 12l2.5 2.5 4.5-5" />
  </Svg>
);
const HomeIcon = () => (
  <Svg>
    <path d="M3 11l9-7 9 7M5 10v10h14V10" />
  </Svg>
);
const PencilIcon = () => (
  <Svg width={1.8}>
    <path d="M4 20l4-1L19 8a2 2 0 0 0-3-3L5 16l-1 4z" />
  </Svg>
);
const ChevIcon = () => (
  <Svg width={2}>
    <path d="M9 6l6 6-6 6" />
  </Svg>
);

export function WhatsListed({ onBack, onMessage }: { onBack: () => void; onMessage: () => void }) {
  const listings = trpc.merchant.listings.useQuery();
  const [editing, setEditing] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [toast, setToast] = useState<string | null>(null);

  function say(message: string) {
    setToast(message);
    setTimeout(() => setToast((t) => (t === message ? null : t)), 2200);
  }

  const rows = listings.data ?? [];
  const paused = [...new Set(rows.filter((l) => l.hiddenReason === "category_paused").map((l) => l.category))];
  const needsLicence = rows.some((l) => l.hiddenReason === "needs_kitchen_licence");
  const lapsed = rows.some((l) => l.hiddenReason === "licence_expired");
  const shown = rows.filter((l) => !l.hidden).length;
  const editingRow = rows.find((l) => l.id === editing) ?? null;

  return (
    <div className="mr-shell">
      <div className="mr-header">
        <button type="button" className="back" onClick={onBack} aria-label="Back to Camera">
          <ChevronLeftIcon />
        </button>
        <h2 className="serif">What&apos;s listed</h2>
      </div>

      <div className="mr-scroll">
        <div className="mr-catbar">
          <button type="button" className="mr-bigbtn green" onClick={() => setAdding(true)}>
            <PlusIcon strokeWidth={2.2} />
            Add a product
          </button>
        </div>

        {paused.length > 0 && (
          <button type="button" className="mr-pausebanner" onClick={onMessage}>
            <span className="ic">
              <PauseIcon />
            </span>
            <span className="m">
              <span className="t">{paused.join(", ")} listings hidden</span>
              <span className="s">This category has been paused for your shop — message us if you have questions.</span>
            </span>
            <span className="arr">
              <ChevIcon />
            </span>
          </button>
        )}
        {lapsed && (
          <button type="button" className="mr-pausebanner" onClick={onMessage}>
            <span className="ic">
              <SnowIcon />
            </span>
            <span className="m">
              <span className="t">Your kitchen licence has expired</span>
              <span className="s">Chilled and frozen listings are hidden. Send us your renewed licence in Messages to bring them back.</span>
            </span>
            <span className="arr">
              <ChevIcon />
            </span>
          </button>
        )}
        {needsLicence && (
          <button type="button" className="mr-pausebanner" onClick={onMessage}>
            <span className="ic">
              <SnowIcon />
            </span>
            <span className="m">
              <span className="t">Chilled and frozen listings hidden</span>
              <span className="s">Cold food needs a licensed kitchen. Send us your licence in Messages to bring them back.</span>
            </span>
            <span className="arr">
              <ChevIcon />
            </span>
          </button>
        )}

        {listings.isLoading ? (
          <div className="mr-empty">
            <p>Loading your products…</p>
          </div>
        ) : listings.isError ? (
          <div className="mr-empty">
            <h3 className="serif">We couldn&apos;t load your products</h3>
            <p>Check your connection and try again.</p>
          </div>
        ) : rows.length === 0 ? (
          <div className="mr-empty">
            <h3 className="serif">Nothing listed yet</h3>
            <p>Tap Add a product to put your first one up.</p>
          </div>
        ) : (
          <>
            <div className="mr-listcount">
              {shown} {shown === 1 ? "product" : "products"} — tap to fix a price or mark one out.
            </div>
            <div className="mr-cat-tiles">
              {rows.map((l) => (
                <button
                  type="button"
                  key={l.id}
                  className={`mr-cat-tile${l.hidden ? " hid" : ""}`}
                  // Hidden products are not editable: changing one would not bring it back.
                  onClick={() => (l.hidden ? onMessage() : setEditing(l.id))}
                >
                  <div className="pic">
                    <span className={`st ${l.hidden ? "hid" : l.inStock ? "in" : "out"}`}>
                      {l.hidden ? "Hidden" : l.inStock ? "In stock" : "Out"}
                    </span>
                    <ProductGlyph kind={glyphFor(l)} />
                  </div>
                  <div className="b">
                    <div className="nm">{l.name}</div>
                    <div className="pr tnum">{money(l.priceCents)}</div>
                    <div className="edit">
                      <PencilIcon />
                      {l.hidden ? "Paused" : "Tap to edit"}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          </>
        )}
        <div className="mr-spacer" />
      </div>

      {editingRow && (
        <EditSheet
          key={editingRow.id}
          listing={editingRow}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            say(`${editingRow.name} updated`);
          }}
        />
      )}
      {adding && <AddSheet onClose={() => setAdding(false)} onMessage={() => { setAdding(false); onMessage(); }} />}

      <div className={`mr-toast${toast ? " show" : ""}`} role="status" aria-live="polite">
        <CheckIcon strokeWidth={2.6} />
        <span>{toast}</span>
      </div>
    </div>
  );
}

/* ------------------------------------------------------------------ sheet */

function Sheet({ title, onClose, children, foot }: { title: string; onClose: () => void; children: ReactNode; foot?: ReactNode }) {
  return (
    <div className="mr-sheet" role="dialog" aria-modal="true" aria-label={title}>
      <div className="mr-sheet-head">
        <button type="button" className="x" onClick={onClose} aria-label="Close">
          <CloseIcon />
        </button>
        <h2 className="serif">{title}</h2>
      </div>
      <div className="mr-sheet-body">{children}</div>
      {foot && <div className="mr-sheet-foot">{foot}</div>}
    </div>
  );
}

/** Price in 50-cent steps and in or out of stock. Nothing to type. */
function EditSheet({ listing, onClose, onSaved }: { listing: Listing; onClose: () => void; onSaved: () => void }) {
  const utils = trpc.useUtils();
  const [price, setPrice] = useState(listing.priceCents);
  const [inStock, setInStock] = useState(listing.inStock);
  const save = trpc.merchant.updateListing.useMutation({
    onSuccess: () => {
      utils.merchant.listings.invalidate();
      onSaved();
    },
  });

  return (
    <Sheet
      title="Edit product"
      onClose={onClose}
      foot={
        <>
          {save.isError && <div className="mr-sheet-err">{save.error.message}</div>}
          <button
            type="button"
            className="mr-bigbtn green"
            disabled={save.isPending}
            onClick={() => save.mutate({ listingId: listing.id, priceCents: price, inStock })}
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
        </>
      }
    >
      <div className="mr-cat-edit">
        <div className="en serif">{listing.name}</div>
        <div className="k">Price</div>
        <div className="mr-bigprice">
          <button type="button" aria-label="Lower the price" onClick={() => setPrice((p) => Math.max(50, p - 50))}>
            −
          </button>
          <div className="v tnum">{money(price)}</div>
          <button type="button" aria-label="Raise the price" onClick={() => setPrice((p) => p + 50)}>
            +
          </button>
        </div>
        <div className="k">Availability</div>
        <div className="mr-stockseg">
          <button type="button" className={`instk${inStock ? " on" : ""}`} onClick={() => setInStock(true)}>
            <CheckIcon strokeWidth={2.2} /> In stock
          </button>
          <button type="button" className={`outstk${!inStock ? " on" : ""}`} onClick={() => setInStock(false)}>
            Out of stock
          </button>
        </div>
      </div>
    </Sheet>
  );
}

/* ------------------------------------------------------------- add a product */

type Notice = "pause" | "cold" | "permit";

/**
 * What are you listing → how is it kept → whichever of the three QC-1 notices
 * applies, in the prototype's order (paused, cold, permit) → ready.
 */
function AddSheet({ onClose, onMessage }: { onClose: () => void; onMessage: () => void }) {
  const utils = trpc.useUtils();
  const standing = trpc.merchant.standing.useQuery();
  const notices = trpc.merchant.categoryNotices.useQuery();
  const [category, setCategory] = useState<AddCategory | null>(null);
  const [cold, setCold] = useState<boolean | null>(null);
  const [notice, setNotice] = useState<Notice | "ready" | null>(null);
  const confirm = trpc.merchant.confirmPermit.useMutation();

  const home = standing.data?.homeTier ?? false;

  /** Decide the next screen. Pure over what the server told us. */
  function check(c: AddCategory, isCold: boolean, permitDone = false): Notice | "ready" {
    if (c.controlled && notices.data?.some((n) => n.category === c.controlled)) return "pause";
    if (isCold && home && standing.data?.kitchen !== "approved") return "cold";
    if (c.controlled && home && !permitDone && !standing.data?.permitsConfirmed.includes(c.controlled)) return "permit";
    return "ready";
  }

  const pausedMessage = notices.data?.find((n) => n.category === category?.controlled)?.message;

  const copy: Record<Notice, { head: string; icon: ReactNode; title: string; body: string; action: string; ghost: string }> = {
    pause: {
      head: "Category paused",
      icon: <PauseIcon />,
      title: "Paused for your shop",
      body: pausedMessage ?? "This category has been paused for your shop — message us if you have questions.",
      action: "Message us",
      ghost: "Not now",
    },
    cold: {
      head: "Chilled and frozen",
      icon: <SnowIcon />,
      title: standing.data?.kitchen === "expired" ? "Your kitchen licence has expired" : "Cold food needs a licensed kitchen",
      body:
        standing.data?.kitchen === "expired"
          ? "Chilled and frozen items can only be sold from a licensed commercial kitchen. Send us your renewed licence in Messages to unlock them again."
          : "Chilled and frozen items can only be sold from a licensed commercial kitchen. Send us your kitchen licence in Messages to unlock them.",
      action: standing.data?.kitchen === "expired" ? "Send renewed licence in Messages" : "Send licence in Messages",
      ghost: "Not now",
    },
    permit: {
      head: "One quick check",
      icon: <ShieldIcon />,
      title: "Do you have any permit your state requires to sell this?",
      body: "We ask once, so every seller follows their state’s food rules.",
      action: "Confirm",
      ghost: "Not yet",
    },
  };

  if (standing.isLoading || notices.isLoading) {
    return (
      <Sheet title="Add a product" onClose={onClose}>
        <div className="mr-reading">
          <div className="spin" />
          <div className="t serif">One moment…</div>
        </div>
      </Sheet>
    );
  }

  if (!category) {
    return (
      <Sheet title="Add a product" onClose={onClose}>
        <div className="mr-cam-prompt">What are you listing?</div>
        <div className="mr-addgrid">
          {ADD_CATEGORIES.map((c) => (
            <button type="button" key={c.label} className="mr-addtile" onClick={() => setCategory(c)}>
              <ProductGlyph kind={c.glyph} />
              <span>{c.label}</span>
            </button>
          ))}
        </div>
      </Sheet>
    );
  }

  if (cold === null) {
    return (
      <Sheet title={category.label} onClose={onClose}>
        <div className="mr-cam-prompt">How is it kept?</div>
        {STORAGE.map((s) => (
          <button
            type="button"
            key={s.label}
            className="mr-storebtn"
            onClick={() => {
              setCold(s.cold);
              setNotice(check(category, s.cold));
            }}
          >
            <span className="ic">{s.cold ? <SnowIcon /> : <HomeIcon />}</span>
            <span>
              <span className="t">{s.label}</span>
              <span className="s">{s.sub}</span>
            </span>
          </button>
        ))}
      </Sheet>
    );
  }

  if (notice === "ready") {
    return (
      <Sheet
        title={category.label}
        onClose={onClose}
        foot={
          <button type="button" className="mr-bigbtn green" onClick={onClose}>
            Done
          </button>
        }
      >
        <div className="mr-notice">
          <div className="ic">
            <CameraIcon />
          </div>
          <h3 className="serif">You&apos;re clear to list this</h3>
          <p>Adding a product from a photo of its label isn&apos;t switched on yet. We&apos;ll tell you here when it is.</p>
        </div>
      </Sheet>
    );
  }

  if (notice) {
    const n = copy[notice];
    return (
      <Sheet
        title={n.head}
        onClose={onClose}
        foot={
          <>
            {confirm.isError && <div className="mr-sheet-err">{confirm.error.message}</div>}
            <button
              type="button"
              className="mr-bigbtn green"
              style={{ marginBottom: 10 }}
              disabled={confirm.isPending}
              onClick={() => {
                if (notice !== "permit") return onMessage();
                if (!category.controlled) return;
                confirm.mutate(
                  { category: category.controlled, acknowledged: true },
                  {
                    onSuccess: async () => {
                      await utils.merchant.standing.invalidate();
                      setNotice(check(category, cold, true));
                    },
                  },
                );
              }}
            >
              {notice === "permit" && <CheckIcon strokeWidth={2.4} />}
              {n.action}
            </button>
            <button type="button" className="mr-bigbtn ghost" onClick={onClose}>
              {n.ghost}
            </button>
          </>
        }
      >
        <div className="mr-notice">
          <div className="ic">{n.icon}</div>
          <h3 className="serif">{n.title}</h3>
          <p>{n.body}</p>
        </div>
      </Sheet>
    );
  }
  return null;
}
