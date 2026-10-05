"use client";

import { useEffect, useState } from "react";
import { trpc } from "@afrimart/api-client";
import { SignIn } from "./SignIn";
import { readStaffToken, writeStaffToken } from "./providers";

const EMPTY = {
  canonicalName: "", shortDescription: "", usedDescription: "", category: "", cuisine: "",
  packSize: "", temperatureClass: "ambient", shippingWeightOz: "8", lengthIn: "8", widthIn: "6", heightIn: "4",
};

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/**
 * PRD 6.11 — the operations console (ADM-1 to ADM-5). ADM-6, store ranking,
 * is Phase 2 and deliberately absent.
 *
 * No prototype exists for this surface, so it follows the PRD's prose and
 * borrows the shared design system rather than inventing a visual language
 * for internal tooling. Plain tables and obvious buttons: the job is to let
 * someone resolve a queue quickly, not to look like the buyer app.
 *
 * There is no staff authentication yet. Every tab here mutates catalogue,
 * onboarding or money, so this must sit behind a login before it is deployed
 * anywhere reachable.
 */
type Tab = "queue" | "stores" | "fulfilment" | "graph" | "finance";

export default function OpsConsole() {
  const [signedIn, setSignedIn] = useState<boolean | null>(null);

  // A token in storage is only a hint. The me() query is what actually proves
  // the session is live, MFA-cleared and not idled out.
  useEffect(() => setSignedIn(Boolean(readStaffToken())), []);

  if (signedIn === null) return null;
  if (!signedIn) return <SignIn onSignedIn={() => setSignedIn(true)} />;
  return <Console onSignedOut={() => { writeStaffToken(null); setSignedIn(false); }} />;
}

function Console({ onSignedOut }: { onSignedOut: () => void }) {
  const [tab, setTab] = useState<Tab>("queue");
  const me = trpc.staffAuth.me.useQuery(undefined, { retry: false });

  // Badge counts, each only fetched by a role allowed to see them — asking
  // anyway would just produce a wall of 403s in the console.
  const perms = me.data?.permissions ?? [];
  const queue = trpc.admin.reviewQueue.useQuery(
    { includeResolved: false },
    { enabled: perms.includes("catalogue:read" as never) },
  );
  const fulfilment = trpc.admin.fulfilment.useQuery(undefined, {
    enabled: perms.includes("fulfilment:read" as never),
  });
  const pendingCount = queue.data?.length ?? 0;
  const stuckCount = fulfilment.data?.filter((s) => s.stuck).length ?? 0;

  // A session that has gone stale server-side surfaces here first, because
  // me() is the one query every role can make.
  if (me.isError) {
    return <SignIn onSignedIn={() => me.refetch()} />;
  }

  const can = (p: string) => me.data?.permissions.includes(p as never) ?? false;

  // Tabs follow permissions. Hiding one is a courtesy, not the control — the
  // server refuses the call regardless of what the console chooses to draw.
  const allTabs: { id: Tab; label: string; badge?: number; shown: boolean }[] = [
    { id: "queue", label: "Catalogue review", badge: pendingCount, shown: can("catalogue:read") },
    { id: "stores", label: "Onboarding", badge: undefined, shown: can("stores:read") },
    { id: "fulfilment", label: "Fulfilment", badge: stuckCount, shown: can("fulfilment:read") },
    { id: "graph", label: "Knowledge graph", badge: undefined, shown: can("graph:read") },
    { id: "finance", label: "Reconciliation", badge: undefined, shown: can("finance:read") },
  ];
  const visible = allTabs.filter((t) => t.shown);

  const active = visible.some((v) => v.id === tab) ? tab : visible[0]?.id;

  return (
    <div className="op-shell">
      <div className="op-top">
        <h1>AfriMart Operations</h1>
        {me.data && (
          <span className="env">
            {me.data.name} · {me.data.role.replace("_", " ")}
          </span>
        )}
        <button type="button" className="op-btn op-signout" onClick={onSignedOut}>
          Sign out
        </button>
      </div>

      <div className="op-tabs">
        {visible.map((t) => (
          <button key={t.id} type="button" className={active === t.id ? "on" : ""} onClick={() => setTab(t.id)}>
            {t.label}
            {t.badge ? <span className="n">{t.badge}</span> : null}
          </button>
        ))}
      </div>

      {active === "queue" && <ReviewQueue />}
      {active === "stores" && <Onboarding />}
      {active === "fulfilment" && <Fulfilment />}
      {active === "graph" && <KnowledgeGraph />}
      {active === "finance" && <Reconciliation />}
    </div>
  );
}

/* ------------------------------------------------------------------ ADM-1 */

function ReviewQueue() {
  const utils = trpc.useUtils();
  const queue = trpc.admin.reviewQueue.useQuery({ includeResolved: false });
  const products = trpc.admin.graph.useQuery({});
  const approve = trpc.admin.approveDraft.useMutation({ onSuccess: () => utils.admin.reviewQueue.invalidate() });
  const reject = trpc.admin.rejectDraft.useMutation({ onSuccess: () => utils.admin.reviewQueue.invalidate() });
  const [choice, setChoice] = useState<Record<string, string>>({});

  if (queue.isLoading) return <p className="op-note">Loading the queue…</p>;
  if (queue.isError) return <p className="op-note">Couldn&apos;t reach the backend. Is it running on :4000?</p>;

  return (
    <div className="op-sec">
      <h2>Catalogue review</h2>
      <p className="lede">
        CAT-6 — items read off a shelf tag or imported from a storefront, held back from the public catalogue until
        someone confirms them. Lowest confidence first, since those are what the threshold is protecting against.
        Approving one is what creates the live listing.
      </p>

      {!queue.data?.length ? (
        <div className="op-empty">Nothing waiting. Everything captured has been resolved.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Confidence</th>
              <th>Read as</th>
              <th>Suggested</th>
              <th>Store</th>
              <th>Resolves to</th>
              <th className="num">Price</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {queue.data.map((d) => (
              <tr key={d.id}>
                <td>
                  <span className={`op-conf ${d.belowThreshold ? "low" : "ok"}`}>{(d.confidence * 100).toFixed(0)}%</span>
                  {d.belowThreshold && (
                    <>
                      {" "}
                      <span className="op-pill warn">needs a human</span>
                    </>
                  )}
                </td>
                <td>
                  <code>{d.rawText}</code>
                </td>
                <td>
                  {d.suggestedName}
                  <div className="muted">
                    {d.packSize ?? "—"} · {d.temperatureClass}
                  </div>
                </td>
                <td>
                  {d.storeName}
                  <div className="muted">{d.metro}</div>
                </td>
                <td>
                  <select
                    className="op-select"
                    value={choice[d.id] ?? d.matchedProduct?.id ?? ""}
                    onChange={(e) => setChoice((p) => ({ ...p, [d.id]: e.target.value }))}
                  >
                    <option value="">— pick a canonical product —</option>
                    {products.data?.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.canonicalName} ({p.packSize})
                      </option>
                    ))}
                  </select>
                  {d.matchedProduct && <div className="muted">matched: {d.matchedProduct.canonicalName}</div>}
                </td>
                <td className="num">{d.suggestedPriceCents ? money(d.suggestedPriceCents) : "—"}</td>
                <td>
                  <div className="op-actions">
                    <button
                      type="button"
                      className="op-btn primary"
                      disabled={!(choice[d.id] ?? d.matchedProduct?.id) || !d.suggestedPriceCents || approve.isPending}
                      onClick={() =>
                        approve.mutate({
                          id: d.id,
                          canonicalProductId: (choice[d.id] ?? d.matchedProduct?.id)!,
                          priceCents: d.suggestedPriceCents!,
                        })
                      }
                    >
                      Approve
                    </button>
                    <button
                      type="button"
                      className="op-btn danger"
                      disabled={reject.isPending}
                      onClick={() => reject.mutate({ id: d.id, note: "Rejected in review" })}
                    >
                      Reject
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ADM-2 */

const ONBOARDING_STATES = ["pending", "filming", "reviewing", "kit_issued", "live", "suspended", "delisted"] as const;

function Onboarding() {
  const utils = trpc.useUtils();
  const stores = trpc.admin.stores.useQuery();
  const hubs = trpc.admin.hubs.useQuery();
  const update = trpc.admin.updateStore.useMutation({ onSuccess: () => utils.admin.stores.invalidate() });

  if (stores.isLoading) return <p className="op-note">Loading stores…</p>;
  if (stores.isError) return <p className="op-note">Couldn&apos;t reach the backend.</p>;

  return (
    <div className="op-sec">
      <h2>Store onboarding</h2>
      <p className="lede">
        ADM-2 — where each seller is in onboarding, their hub assignment, and verification. SEL-2 gates routing: a
        store that is not both verified and live receives no orders, however much catalogue it has.
      </p>

      <table className="op-table">
        <thead>
          <tr>
            <th>Store</th>
            <th>Type</th>
            <th>Hub</th>
            <th>Onboarding</th>
            <th>Verification</th>
            <th className="num">Listings</th>
            <th>Routable</th>
          </tr>
        </thead>
        <tbody>
          {stores.data?.map((s) => (
            <tr key={s.id}>
              <td>
                {s.name}
                <div className="muted">{s.ownerName}</div>
              </td>
              <td className="muted">{s.sellerType}</td>
              <td>
                <select
                  className="op-select"
                  value={s.hubMetroId}
                  onChange={(e) => update.mutate({ id: s.id, hubMetroId: e.target.value })}
                >
                  {hubs.data?.map((h) => (
                    <option key={h.id} value={h.id}>
                      {h.name}, {h.state}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="op-select"
                  value={s.onboardingStatus}
                  onChange={(e) =>
                    update.mutate({ id: s.id, onboardingStatus: e.target.value as (typeof ONBOARDING_STATES)[number] })
                  }
                >
                  {ONBOARDING_STATES.map((st) => (
                    <option key={st} value={st}>
                      {st.replace("_", " ")}
                    </option>
                  ))}
                </select>
              </td>
              <td>
                <select
                  className="op-select"
                  value={s.verificationStatus}
                  onChange={(e) =>
                    update.mutate({
                      id: s.id,
                      verificationStatus: e.target.value as "unverified" | "pending" | "verified",
                    })
                  }
                >
                  <option value="unverified">unverified</option>
                  <option value="pending">pending</option>
                  <option value="verified">verified</option>
                </select>
              </td>
              <td className="num">
                {s.listingCount}
                {s.pendingDrafts ? <div className="muted">{s.pendingDrafts} drafts</div> : null}
              </td>
              <td>
                <span className={`op-pill ${s.canReceiveOrders ? "good" : "bad"}`}>
                  {s.canReceiveOrders ? "routable" : "blocked"}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ------------------------------------------------------------------ ADM-3 */

function Fulfilment() {
  const utils = trpc.useUtils();
  const rows = trpc.admin.fulfilment.useQuery();
  const intervene = trpc.admin.interveneShipment.useMutation({ onSuccess: () => utils.admin.fulfilment.invalidate() });

  if (rows.isLoading) return <p className="op-note">Loading open shipments…</p>;
  if (rows.isError) return <p className="op-note">Couldn&apos;t reach the backend.</p>;

  const stuck = rows.data?.filter((r) => r.stuck) ?? [];

  return (
    <div className="op-sec">
      <h2>Fulfilment</h2>
      <p className="lede">
        ADM-3 — every open shipment, oldest first. A parcel a seller has not moved inside the window is flagged as
        stuck so it can be chased before the buyer notices rather than after.
      </p>

      {stuck.length > 0 && (
        <div className="op-cards">
          <div className="op-card alert">
            <div className="k">Stuck</div>
            <div className="v">{stuck.length}</div>
            <div className="s">waiting past the window</div>
          </div>
        </div>
      )}

      {!rows.data?.length ? (
        <div className="op-empty">No open shipments.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Order</th>
              <th>Store</th>
              <th>Status</th>
              <th className="num">Waiting</th>
              <th className="num">Items</th>
              <th className="num">Value</th>
              <th>Intervene</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={r.shipmentId}>
                <td>
                  {r.orderRef}
                  <div className="muted">{r.buyer}</div>
                </td>
                <td>
                  {r.storeName}
                  <div className="muted">
                    {r.temperatureClass}
                    {r.carrier ? ` · ${r.carrier}` : ""}
                  </div>
                </td>
                <td>
                  <span className={`op-pill ${r.stuck ? "bad" : "good"}`}>{r.status}</span>
                </td>
                <td className="num">
                  {r.hoursWaiting}h{r.stuck && <div className="muted">stuck</div>}
                </td>
                <td className="num">{r.itemCount}</td>
                <td className="num">{money(r.valueCents)}</td>
                <td>
                  <div className="op-actions">
                    <button
                      type="button"
                      className="op-btn"
                      onClick={() => intervene.mutate({ shipmentId: r.shipmentId, action: "mark_shipped" })}
                    >
                      Shipped
                    </button>
                    <button
                      type="button"
                      className="op-btn"
                      onClick={() => intervene.mutate({ shipmentId: r.shipmentId, action: "flag_exception" })}
                    >
                      Exception
                    </button>
                    <button
                      type="button"
                      className="op-btn danger"
                      onClick={() => intervene.mutate({ shipmentId: r.shipmentId, action: "cancel_order" })}
                    >
                      Cancel order
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ADM-4 */

function KnowledgeGraph() {
  const utils = trpc.useUtils();
  const [search, setSearch] = useState("");
  const graph = trpc.admin.graph.useQuery({ search });
  const addAlias = trpc.admin.addAlias.useMutation({ onSuccess: () => utils.admin.graph.invalidate() });
  const removeAlias = trpc.admin.removeAlias.useMutation({ onSuccess: () => utils.admin.graph.invalidate() });
  const [draft, setDraft] = useState<Record<string, { alias: string; language: string }>>({});

  return (
    <div className="op-sec">
      <h2>Knowledge graph</h2>
      <p className="lede">
        CAT-2/ADM-4 — the canonical products and every name that resolves to one. This is what makes a fragmented,
        multilingual supply base searchable as a single catalogue, so a missing alias is a product nobody can find.
      </p>

      <div className="op-form">
        <div>
          <label htmlFor="gsearch">Search names and aliases</label>
          <input
            id="gsearch"
            className="op-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="egusi, ẹ̀gúsí, melon seeds…"
          />
        </div>
      </div>

      <NewCanonicalProduct />

      {graph.isLoading ? (
        <p className="op-note">Loading…</p>
      ) : !graph.data?.length ? (
        <div className="op-empty">No canonical products match that.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Canonical product</th>
              <th className="num">Listings</th>
              <th>Aliases</th>
              <th>Add a name</th>
            </tr>
          </thead>
          <tbody>
            {graph.data.map((p) => (
              <tr key={p.id}>
                <td>
                  {p.canonicalName}
                  <div className="muted">
                    {p.category} · {p.cuisine} · {p.packSize}
                  </div>
                </td>
                <td className="num">{p.listingCount}</td>
                <td>
                  <div className="op-actions">
                    {p.aliases.map((a) => (
                      <span key={a.id} className="op-pill">
                        {a.alias}
                        <span className="muted"> {a.language}</span>{" "}
                        <button
                          type="button"
                          onClick={() => removeAlias.mutate({ id: a.id })}
                          style={{ border: 0, background: "none", cursor: "pointer", color: "inherit" }}
                          aria-label={`Remove ${a.alias}`}
                        >
                          ×
                        </button>
                      </span>
                    ))}
                    {!p.aliases.length && <span className="muted">none</span>}
                  </div>
                </td>
                <td>
                  <div className="op-actions">
                    <input
                      className="op-input"
                      style={{ maxWidth: 130 }}
                      placeholder="alias"
                      value={draft[p.id]?.alias ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [p.id]: { language: d[p.id]?.language ?? "", alias: e.target.value } }))
                      }
                    />
                    <input
                      className="op-input"
                      style={{ maxWidth: 110 }}
                      placeholder="language"
                      value={draft[p.id]?.language ?? ""}
                      onChange={(e) =>
                        setDraft((d) => ({ ...d, [p.id]: { alias: d[p.id]?.alias ?? "", language: e.target.value } }))
                      }
                    />
                    <button
                      type="button"
                      className="op-btn"
                      disabled={!draft[p.id]?.alias || !draft[p.id]?.language}
                      onClick={() => {
                        addAlias.mutate({
                          canonicalProductId: p.id,
                          alias: draft[p.id].alias,
                          language: draft[p.id].language,
                        });
                        setDraft((d) => ({ ...d, [p.id]: { alias: "", language: "" } }));
                      }}
                    >
                      Add
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ------------------------------------------------------------------ ADM-5 */

function Reconciliation() {
  const r = trpc.admin.reconciliation.useQuery();

  if (r.isLoading) return <p className="op-note">Loading…</p>;
  if (r.isError) return <p className="op-note">Couldn&apos;t reach the backend.</p>;
  const d = r.data!;

  return (
    <div className="op-sec">
      <h2>Reconciliation</h2>
      <p className="lede">
        ADM-5 — does the money add up. Item value sellers sold must equal what they are paid plus the platform&apos;s
        commission and order fee. Shipping is pass-through and sits outside that identity entirely: it is collected
        from the buyer and paid to carriers, and is never part of commission (PAY-3).
      </p>

      <div className="op-cards">
        <div className="op-card">
          <div className="k">Orders</div>
          <div className="v">{d.orderCount}</div>
        </div>
        <div className="op-card">
          <div className="k">Buyers charged</div>
          <div className="v">{money(d.buyerChargedCents)}</div>
          <div className="s">incl. shipping and tax</div>
        </div>
        <div className="op-card">
          <div className="k">Sellers owed</div>
          <div className="v">{money(d.sellerNetCents)}</div>
          <div className="s">of {money(d.sellerGrossCents)} gross</div>
        </div>
        <div className="op-card">
          <div className="k">Platform revenue</div>
          <div className="v">{money(d.platformRevenueCents)}</div>
          <div className="s">
            {money(d.commissionCents)} commission · {money(d.fulfilmentFeeCents)} fees
          </div>
        </div>
        <div className="op-card">
          <div className="k">Shipping collected</div>
          <div className="v">{money(d.shippingCollectedCents)}</div>
          <div className="s">passed to carriers</div>
        </div>
        <div className="op-card">
          <div className="k">Tax collected</div>
          <div className="v">{money(d.taxCollectedCents)}</div>
          <div className="s">remitted separately</div>
        </div>
        <div className={`op-card${d.heldCount ? " alert" : ""}`}>
          <div className="k">Held (PAY-8)</div>
          <div className="v">{money(d.heldCents)}</div>
          <div className="s">{d.heldCount} payouts awaiting release</div>
        </div>
        <div className={`op-card${d.reconciliationDriftCents !== 0 ? " alert" : ""}`}>
          <div className="k">Drift</div>
          <div className="v">{money(d.reconciliationDriftCents)}</div>
          <div className="s">{d.reconciliationDriftCents === 0 ? "balanced" : "payouts and orders disagree"}</div>
        </div>
      </div>

      <h2 style={{ marginTop: 22 }}>Carrier adjustments (PAY-9)</h2>
      <p className="lede">
        Billing corrections from wrong declared weight or dimensions, charged back to the seller who declared them.
      </p>
      {!d.adjustments.length ? (
        <div className="op-empty">No carrier adjustments. The feed is stubbed until EasyPost is wired.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Store</th>
              <th>Reason</th>
              <th className="num">Declared</th>
              <th className="num">Actual</th>
              <th className="num">Amount</th>
              <th>Settled</th>
            </tr>
          </thead>
          <tbody>
            {d.adjustments.map((a) => (
              <tr key={a.id}>
                <td>{a.storeName}</td>
                <td className="muted">{a.reason}</td>
                <td className="num">{(a.declaredWeightOz / 16).toFixed(1)}lb</td>
                <td className="num">{(a.actualWeightOz / 16).toFixed(1)}lb</td>
                <td className="num">{money(a.amountCents)}</td>
                <td>
                  <span className={`op-pill ${a.settled ? "good" : "warn"}`}>{a.settled ? "settled" : "open"}</span>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      <h2 style={{ marginTop: 22 }}>Payouts</h2>
      {!d.payouts.length ? (
        <div className="op-empty">No payouts yet.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Store</th>
              <th className="num">Gross</th>
              <th className="num">Net</th>
              <th>Status</th>
              <th>Hold</th>
            </tr>
          </thead>
          <tbody>
            {d.payouts.map((p) => (
              <tr key={p.id}>
                <td>{p.storeName}</td>
                <td className="num">{money(p.grossCents)}</td>
                <td className="num">{money(p.netCents)}</td>
                <td>
                  <span className="op-pill">{p.status}</span>
                </td>
                <td className="muted">
                  {p.heldUntil ? `until ${new Date(p.heldUntil).toLocaleDateString()}` : "—"}
                  {p.holdReason ? <div>{p.holdReason}</div> : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/**
 * ADM-4 — creating a canonical product, not just aliasing an existing one.
 *
 * Without this the review queue dead-ends: an item the catalogue has never
 * carried (the first smoked catfish, say) can never be approved, because
 * approval requires a canonical product to resolve to and there is no way to
 * make one. CAT-3 also wants this deliberate rather than implicit — an
 * approval that silently invented products would fill the graph with
 * near-duplicates of things already in it.
 */
function NewCanonicalProduct() {
  const utils = trpc.useUtils();
  const create = trpc.admin.addCanonicalProduct.useMutation({
    onSuccess: () => {
      utils.admin.graph.invalidate();
      setOpen(false);
      setForm(EMPTY);
    },
  });
  const [open, setOpen] = useState(false);
  const [form, setForm] = useState(EMPTY);

  const set = (k: keyof typeof EMPTY) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) =>
    setForm((f) => ({ ...f, [k]: e.target.value }));

  const complete =
    form.canonicalName && form.shortDescription && form.usedDescription && form.category && form.cuisine && form.packSize;

  if (!open) {
    return (
      <div style={{ marginBottom: 16 }}>
        <button type="button" className="op-btn" onClick={() => setOpen(true)}>
          + New canonical product
        </button>
      </div>
    );
  }

  return (
    <div className="op-note" style={{ marginBottom: 18 }}>
      <div className="op-form">
        <div>
          <label htmlFor="cn">Canonical name</label>
          <input id="cn" className="op-input" value={form.canonicalName} onChange={set("canonicalName")} placeholder="Ground crayfish" />
        </div>
        <div>
          <label htmlFor="cd">Short description</label>
          <input id="cd" className="op-input" value={form.shortDescription} onChange={set("shortDescription")} placeholder="Dried, finely ground" />
        </div>
        <div>
          <label htmlFor="cc">Category</label>
          <input id="cc" className="op-input" value={form.category} onChange={set("category")} placeholder="Fish &amp; seafood" />
        </div>
        <div>
          <label htmlFor="cu">Cuisine</label>
          <input id="cu" className="op-input" value={form.cuisine} onChange={set("cuisine")} placeholder="Nigerian" />
        </div>
        <div>
          <label htmlFor="cp">Pack size</label>
          <input id="cp" className="op-input" value={form.packSize} onChange={set("packSize")} placeholder="200g" />
        </div>
        <div>
          <label htmlFor="ct">Temperature</label>
          <select id="ct" className="op-select" value={form.temperatureClass} onChange={set("temperatureClass")}>
            <option value="ambient">ambient</option>
            <option value="refrigerated">refrigerated</option>
            <option value="frozen">frozen</option>
          </select>
        </div>
      </div>
      <div className="op-form">
        <div>
          <label htmlFor="cw">Weight (oz)</label>
          <input id="cw" className="op-input" style={{ maxWidth: 110 }} value={form.shippingWeightOz} onChange={set("shippingWeightOz")} />
        </div>
        <div>
          <label htmlFor="cl">Length (in)</label>
          <input id="cl" className="op-input" style={{ maxWidth: 110 }} value={form.lengthIn} onChange={set("lengthIn")} />
        </div>
        <div>
          <label htmlFor="cwi">Width (in)</label>
          <input id="cwi" className="op-input" style={{ maxWidth: 110 }} value={form.widthIn} onChange={set("widthIn")} />
        </div>
        <div>
          <label htmlFor="ch">Height (in)</label>
          <input id="ch" className="op-input" style={{ maxWidth: 110 }} value={form.heightIn} onChange={set("heightIn")} />
        </div>
      </div>
      <div className="op-form">
        <div style={{ flex: 1 }}>
          <label htmlFor="cud">How it&apos;s used (shown on the product page, and grounds the agent)</label>
          <input id="cud" className="op-input" style={{ maxWidth: 620 }} value={form.usedDescription} onChange={set("usedDescription")} />
        </div>
      </div>
      {/* CAT-5 — dimensions are required, not optional: carriers bill on the
          greater of actual and dimensional weight, and a wrong box here
          becomes a chargeback against the seller later (PAY-9). */}
      <div className="op-actions">
        <button
          type="button"
          className="op-btn primary"
          disabled={!complete || create.isPending}
          onClick={() =>
            create.mutate({
              canonicalName: form.canonicalName,
              shortDescription: form.shortDescription,
              usedDescription: form.usedDescription,
              category: form.category,
              cuisine: form.cuisine,
              packSize: form.packSize,
              temperatureClass: form.temperatureClass as "ambient" | "refrigerated" | "frozen",
              shippingWeightOz: Number(form.shippingWeightOz) || 8,
              lengthIn: Number(form.lengthIn) || 8,
              widthIn: Number(form.widthIn) || 6,
              heightIn: Number(form.heightIn) || 4,
            })
          }
        >
          Create
        </button>
        <button type="button" className="op-btn" onClick={() => setOpen(false)}>
          Cancel
        </button>
        {create.isError && <span className="muted">{create.error.message}</span>}
      </div>
    </div>
  );
}
