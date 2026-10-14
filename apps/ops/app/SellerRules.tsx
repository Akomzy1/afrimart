"use client";

import { useState } from "react";
import { trpc } from "@afrimart/api-client";

/**
 * QC-1 — the operations side of the home-based and aspiring seller rules.
 *
 * Four things an operator does here, none of which a seller can do for
 * themselves: decide kitchen-licence and badge applications, switch a food
 * category off for the whole tier (admin only), switch one off for one seller,
 * and read who changed what and why.
 *
 * No prototype exists for the console, so this follows the PRD's prose and the
 * existing console's plain tables. Hiding a control is a courtesy: the server
 * refuses the call whatever this page draws, and the message it returns is
 * shown as it was written.
 */

const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").origin;

/**
 * What the seller sent. Words are shown as written. A photo of a document is
 * private, so it is not linked from the table: opening it asks the server for a
 * short-lived signed link, and that request is written to the audit log with who
 * made it. The link opens in a new tab.
 */
function Evidence({
  text, hasPhoto, subject, id,
}: { text: string | null; hasPhoto: boolean; subject: "kitchen_licence" | "seller_badge"; id: string }) {
  const open = trpc.admin.evidencePhotoLink.useMutation({
    onSuccess: ({ url }) => window.open(`${API_ORIGIN}${url}`, "_blank", "noopener,noreferrer"),
  });
  return (
    <>
      {text ?? (hasPhoto ? null : "—")}
      {hasPhoto && (
        <div>
          <button type="button" className="op-btn" disabled={open.isPending} onClick={() => open.mutate({ subject, id })}>
            {open.isPending ? "Opening…" : "Open the photo"}
          </button>
          <div className="muted">Opening it is recorded.</div>
          {open.isError && <div className="op-note">{open.error.message}</div>}
        </div>
      )}
    </>
  );
}

const CATEGORIES = ["meat", "poultry", "fish", "dairy"] as const;
type Category = (typeof CATEGORIES)[number];

const BADGE_LABEL: Record<string, string> = {
  diaspora_owned: "Diaspora-owned",
  imported_direct: "Imported direct",
  made_in_usa_african_brand: "Made in USA by an African brand",
};

const SELLER_RULE_ACTIONS = [
  "store.kitchen_licence_change",
  "store.category_restriction_change",
  "platform.category_restriction_change",
  "product.reclassify",
  "store.verification_change",
];

const ACTION_LABEL: Record<string, string> = {
  "store.kitchen_licence_change": "Kitchen licence",
  "store.category_restriction_change": "Seller category switch",
  "platform.category_restriction_change": "Platform category switch",
  "product.reclassify": "Product reclassified",
  "store.verification_change": "Verification / badge",
};

const when = (d: Date | string) => new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

function Err({ error }: { error: { message: string } | null | undefined }) {
  return error ? <div className="op-err">{error.message}</div> : null;
}

export function SellerRules({ canWrite, canSettings, canAudit }: { canWrite: boolean; canSettings: boolean; canAudit: boolean }) {
  return (
    <>
      <KitchenLicences canWrite={canWrite} />
      <Badges canWrite={canWrite} />
      <PlatformSwitches canSettings={canSettings} />
      <SellerSwitches canWrite={canWrite} />
      {canAudit && <RecentChanges />}
    </>
  );
}

/* ------------------------------------------------------- kitchen licences */

type LicenceStatus = "applied" | "approved" | "rejected" | "revoked";

function KitchenLicences({ canWrite }: { canWrite: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<LicenceStatus>("applied");
  const rows = trpc.admin.kitchenLicences.useQuery({ status });
  const review = trpc.admin.reviewKitchenLicence.useMutation({
    onSuccess: () => {
      utils.admin.kitchenLicences.invalidate();
      utils.admin.stores.invalidate();
      utils.admin.auditLog.invalidate();
    },
  });
  const [note, setNote] = useState<Record<string, string>>({});
  const [checked, setChecked] = useState<Record<string, boolean>>({});
  // What the reviewer reads off the licence; the server refuses an approval without all three.
  const [detail, setDetail] = useState<Record<string, { number?: string; authority?: string; expires?: string }>>({});

  return (
    <div className="op-sec">
      <h2>Licensed kitchen applications</h2>
      <p className="lede">
        QC-1 — a licensed commercial kitchen is what lets a home-based or aspiring seller list chilled and frozen
        food. Sellers apply; it is never self-declared. Approve only after checking the licence itself. Revoking
        takes that seller&apos;s chilled and frozen listings down again.
      </p>

      <div className="op-form">
        <div>
          <label htmlFor="licstatus">Show</label>
          <select id="licstatus" className="op-select" value={status} onChange={(e) => setStatus(e.target.value as LicenceStatus)}>
            <option value="applied">waiting for review</option>
            <option value="approved">approved</option>
            <option value="rejected">refused</option>
            <option value="revoked">revoked</option>
          </select>
        </div>
      </div>

      {rows.isLoading ? (
        <p className="op-note">Loading…</p>
      ) : !rows.data?.length ? (
        <div className="op-empty">Nothing here.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Seller</th>
              <th>Licence</th>
              <th>Evidence</th>
              <th>{status === "applied" ? "Applied" : "Decided"}</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((r) => (
              <tr key={r.id}>
                <td>
                  {r.storeName}
                  <div className="muted">{r.sellerType.replace("_", " ")}</div>
                </td>
                <td>
                  {r.licenceNumber ?? <span className="muted">Number on the photo</span>}
                  <div className="muted">{r.issuingAuthority}</div>
                </td>
                <td className="muted">
                  <Evidence text={r.evidence} hasPhoto={r.hasEvidencePhoto} subject="kitchen_licence" id={r.id} />
                </td>
                <td className="muted">
                  {when(status === "applied" ? r.createdAt : (r.reviewedAt ?? r.createdAt))}
                  {r.reviewedByEmail ? <div>{r.reviewedByEmail}</div> : null}
                  {r.reviewNote ? <div>{r.reviewNote}</div> : null}
                </td>
                <td>
                  {!canWrite ? (
                    <span className="muted">view only</span>
                  ) : status === "applied" || status === "approved" ? (
                    <div>
                      {status === "applied" && (
                        <label style={{ display: "flex", gap: 6, alignItems: "center", fontSize: 12, marginBottom: 6 }}>
                          <input
                            type="checkbox"
                            checked={Boolean(checked[r.id])}
                            onChange={(e) => setChecked((c) => ({ ...c, [r.id]: e.target.checked }))}
                          />
                          I have checked the licence itself
                        </label>
                      )}
                      {status === "applied" && (
                        <div style={{ display: "grid", gap: 6, marginBottom: 6 }}>
                          <input
                            className="op-input"
                            aria-label="Licence number, as printed on the licence"
                            placeholder="Licence number (from the licence)"
                            value={detail[r.id]?.number ?? ""}
                            onChange={(e) => setDetail((d) => ({ ...d, [r.id]: { ...d[r.id], number: e.target.value } }))}
                          />
                          <input
                            className="op-input"
                            aria-label="Who issued the licence"
                            placeholder="Issuing authority"
                            value={detail[r.id]?.authority ?? ""}
                            onChange={(e) => setDetail((d) => ({ ...d, [r.id]: { ...d[r.id], authority: e.target.value } }))}
                          />
                          <label style={{ fontSize: 12 }}>
                            Expires on
                            <input
                              className="op-input"
                              type="date"
                              value={detail[r.id]?.expires ?? ""}
                              onChange={(e) => setDetail((d) => ({ ...d, [r.id]: { ...d[r.id], expires: e.target.value } }))}
                            />
                          </label>
                        </div>
                      )}
                      {status === "approved" && (
                        <div className="muted" style={{ marginBottom: 6 }}>
                          {r.verifiedLicenceNumber} · {r.verifiedIssuingAuthority}
                          <div>Expires {r.licenceExpiresOn ? new Date(r.licenceExpiresOn).toISOString().slice(0, 10) : "—"}</div>
                        </div>
                      )}
                      <input
                        className="op-input"
                        placeholder="Reason (required)"
                        value={note[r.id] ?? ""}
                        onChange={(e) => setNote((n) => ({ ...n, [r.id]: e.target.value }))}
                      />
                      <div className="op-actions" style={{ marginTop: 6 }}>
                        {status === "applied" ? (
                          <>
                            <button
                              type="button"
                              className="op-btn primary"
                              disabled={
                                !checked[r.id] ||
                                !note[r.id]?.trim() ||
                                !detail[r.id]?.number?.trim() ||
                                !detail[r.id]?.authority?.trim() ||
                                !detail[r.id]?.expires ||
                                review.isPending
                              }
                              onClick={() =>
                                review.mutate({
                                  id: r.id,
                                  decision: "approve",
                                  licenceChecked: true,
                                  licenceNumber: detail[r.id]!.number!.trim(),
                                  issuingAuthority: detail[r.id]!.authority!.trim(),
                                  expiresOn: new Date(`${detail[r.id]!.expires}T00:00:00.000Z`),
                                  note: note[r.id]!.trim(),
                                })
                              }
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="op-btn danger"
                              disabled={!note[r.id]?.trim() || review.isPending}
                              onClick={() => review.mutate({ id: r.id, decision: "reject", note: note[r.id]!.trim() })}
                            >
                              Refuse
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="op-btn danger"
                            disabled={!note[r.id]?.trim() || review.isPending}
                            onClick={() => review.mutate({ id: r.id, decision: "revoke", note: note[r.id]!.trim() })}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                      {review.variables?.id === r.id && <Err error={review.error} />}
                    </div>
                  ) : (
                    <span className="muted">closed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ----------------------------------------------------------------- badges */

function Badges({ canWrite }: { canWrite: boolean }) {
  const utils = trpc.useUtils();
  const [status, setStatus] = useState<LicenceStatus>("applied");
  const rows = trpc.admin.badgeApplications.useQuery({ status });
  const review = trpc.admin.reviewBadge.useMutation({
    onSuccess: () => {
      utils.admin.badgeApplications.invalidate();
      utils.admin.auditLog.invalidate();
    },
  });
  const [note, setNote] = useState<Record<string, string>>({});

  return (
    <div className="op-sec">
      <h2>Badge applications</h2>
      <p className="lede">
        CAT-8 — authenticity and provenance badges. A seller applies and a reviewer decides; a badge a seller could
        switch on for themselves would tell a buyer nothing.
      </p>

      <div className="op-form">
        <div>
          <label htmlFor="badgestatus">Show</label>
          <select id="badgestatus" className="op-select" value={status} onChange={(e) => setStatus(e.target.value as LicenceStatus)}>
            <option value="applied">waiting for review</option>
            <option value="approved">approved</option>
            <option value="rejected">refused</option>
            <option value="revoked">revoked</option>
          </select>
        </div>
      </div>

      {rows.isLoading ? (
        <p className="op-note">Loading…</p>
      ) : !rows.data?.length ? (
        <div className="op-empty">Nothing here.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Seller</th>
              <th>Badge</th>
              <th>Evidence</th>
              <th>Applied</th>
              <th>Decision</th>
            </tr>
          </thead>
          <tbody>
            {rows.data.map((b) => (
              <tr key={b.id}>
                <td>
                  {b.storeName}
                  <div className="muted">{b.sellerType.replace("_", " ")}</div>
                </td>
                <td>{BADGE_LABEL[b.kind] ?? b.kind}</td>
                <td className="muted">
                  <Evidence text={b.evidence} hasPhoto={b.hasEvidencePhoto} subject="seller_badge" id={b.id} />
                </td>
                <td className="muted">
                  {when(b.createdAt)}
                  {b.reviewNote ? <div>{b.reviewNote}</div> : null}
                </td>
                <td>
                  {!canWrite ? (
                    <span className="muted">view only</span>
                  ) : status === "applied" || status === "approved" ? (
                    <div>
                      <input
                        className="op-input"
                        placeholder="Note"
                        value={note[b.id] ?? ""}
                        onChange={(e) => setNote((n) => ({ ...n, [b.id]: e.target.value }))}
                      />
                      <div className="op-actions" style={{ marginTop: 6 }}>
                        {status === "applied" ? (
                          <>
                            <button
                              type="button"
                              className="op-btn primary"
                              disabled={review.isPending}
                              onClick={() => review.mutate({ badgeId: b.id, decision: "approve", note: note[b.id]?.trim() || undefined })}
                            >
                              Approve
                            </button>
                            <button
                              type="button"
                              className="op-btn danger"
                              disabled={review.isPending}
                              onClick={() => review.mutate({ badgeId: b.id, decision: "reject", note: note[b.id]?.trim() || undefined })}
                            >
                              Refuse
                            </button>
                          </>
                        ) : (
                          <button
                            type="button"
                            className="op-btn danger"
                            disabled={review.isPending}
                            onClick={() => review.mutate({ badgeId: b.id, decision: "revoke", note: note[b.id]?.trim() || undefined })}
                          >
                            Revoke
                          </button>
                        )}
                      </div>
                      {review.variables?.badgeId === b.id && <Err error={review.error} />}
                    </div>
                  ) : (
                    <span className="muted">closed</span>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------------------------------------------- platform-wide switch */

function PlatformSwitches({ canSettings }: { canSettings: boolean }) {
  const utils = trpc.useUtils();
  const controls = trpc.admin.categoryControls.useQuery();
  const set = trpc.admin.setPlatformCategory.useMutation({
    onSuccess: () => {
      utils.admin.categoryControls.invalidate();
      utils.admin.auditLog.invalidate();
    },
  });
  const [reason, setReason] = useState<Record<string, string>>({});

  return (
    <div className="op-sec">
      <h2>Food categories — all home-based and aspiring sellers</h2>
      <p className="lede">
        QC-1 — meat, poultry, fish and dairy are open to this tier by default. Switching one off hides every such
        seller&apos;s existing listings in it and refuses new ones, in case legal advice changes. Stores are never
        affected, and nothing is deleted: switching it back on restores the listings.
        {!canSettings && " Only an administrator can change these."}
      </p>

      <div className="op-cards">
        {controls.data?.platform.map((c) => (
          <div className={`op-card${c.disabled ? " alert" : ""}`} key={c.category}>
            <div className="k">{c.label}</div>
            <div className="v">{c.disabled ? "Off" : "On"}</div>
            <div className="s">
              {c.disabled && c.reason ? `${c.reason}` : "listable by default"}
              {c.changedBy && c.changedAt ? ` · ${c.changedBy}, ${when(c.changedAt)}` : ""}
            </div>
            {canSettings && (
              <div style={{ marginTop: 10 }}>
                <input
                  className="op-input"
                  placeholder="Reason (required)"
                  value={reason[c.category] ?? ""}
                  onChange={(e) => setReason((r) => ({ ...r, [c.category]: e.target.value }))}
                />
                <button
                  type="button"
                  className={`op-btn ${c.disabled ? "primary" : "danger"}`}
                  style={{ marginTop: 6 }}
                  disabled={!reason[c.category]?.trim() || set.isPending}
                  onClick={() => {
                    set.mutate({ category: c.category, disabled: !c.disabled, reason: reason[c.category]!.trim() });
                    setReason((r) => ({ ...r, [c.category]: "" }));
                  }}
                >
                  {c.disabled ? "Switch back on" : "Switch off for the tier"}
                </button>
                {set.variables?.category === c.category && <Err error={set.error} />}
              </div>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}

/* ------------------------------------------------------- per-seller switch */

function SellerSwitches({ canWrite }: { canWrite: boolean }) {
  const utils = trpc.useUtils();
  const controls = trpc.admin.categoryControls.useQuery();
  const stores = trpc.admin.stores.useQuery();
  const set = trpc.admin.setSellerCategory.useMutation({
    onSuccess: () => {
      utils.admin.categoryControls.invalidate();
      utils.admin.stores.invalidate();
      utils.admin.auditLog.invalidate();
    },
  });
  const [form, setForm] = useState<{ storeId: string; category: Category; reason: string }>({
    storeId: "",
    category: "meat",
    reason: "",
  });
  const [reason, setReason] = useState<Record<string, string>>({});

  // Only home-based and aspiring sellers can carry a switch; offering a store
  // here would invite a call the server refuses.
  const homeTier = stores.data?.filter((s) => s.sellerType !== "store") ?? [];
  const key = (storeId: string, category: string) => `${storeId}:${category}`;

  return (
    <div className="op-sec">
      <h2>Food categories — one seller</h2>
      <p className="lede">
        QC-1 — switch one category off for one home-based or aspiring seller. Their existing listings in it are hidden
        and new ones refused; they are told why, with how to reach support. The reason below is for staff and is not
        shown to the seller.
      </p>

      {canWrite && (
        <div className="op-form">
          <div>
            <label htmlFor="ssstore">Seller</label>
            <select id="ssstore" className="op-select" value={form.storeId} onChange={(e) => setForm((f) => ({ ...f, storeId: e.target.value }))}>
              <option value="">— pick a seller —</option>
              {homeTier.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name} ({s.sellerType.replace("_", " ")})
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="sscat">Category</label>
            <select id="sscat" className="op-select" value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value as Category }))}>
              {CATEGORIES.map((c) => (
                <option key={c} value={c}>
                  {c}
                </option>
              ))}
            </select>
          </div>
          <div style={{ flex: 1 }}>
            <label htmlFor="ssreason">Reason (required)</label>
            <input id="ssreason" className="op-input" style={{ maxWidth: 420 }} value={form.reason} onChange={(e) => setForm((f) => ({ ...f, reason: e.target.value }))} />
          </div>
          <button
            type="button"
            className="op-btn danger"
            disabled={!form.storeId || !form.reason.trim() || set.isPending}
            onClick={() => {
              set.mutate({ storeId: form.storeId, category: form.category, disabled: true, reason: form.reason.trim() });
              setForm((f) => ({ ...f, reason: "" }));
            }}
          >
            Switch off
          </button>
        </div>
      )}
      <Err error={set.error} />

      {controls.isLoading ? (
        <p className="op-note">Loading…</p>
      ) : !controls.data?.sellers.length ? (
        <div className="op-empty">No seller has a category switched off.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>Seller</th>
              <th>Category</th>
              <th>Reason</th>
              <th>Switched off</th>
              <th>Switch back on</th>
            </tr>
          </thead>
          <tbody>
            {controls.data.sellers.map((s) => {
              const k = key(s.storeId, s.category);
              return (
                <tr key={k}>
                  <td>{s.storeName}</td>
                  <td>
                    <span className="op-pill warn">{s.category}</span>
                  </td>
                  <td className="muted">{s.reason}</td>
                  <td className="muted">
                    {when(s.changedAt)}
                    <div>{s.changedBy}</div>
                  </td>
                  <td>
                    {canWrite ? (
                      <div className="op-actions">
                        <input
                          className="op-input"
                          style={{ maxWidth: 190 }}
                          placeholder="Reason (required)"
                          value={reason[k] ?? ""}
                          onChange={(e) => setReason((r) => ({ ...r, [k]: e.target.value }))}
                        />
                        <button
                          type="button"
                          className="op-btn primary"
                          disabled={!reason[k]?.trim() || set.isPending}
                          onClick={() => {
                            set.mutate({ storeId: s.storeId, category: s.category, disabled: false, reason: reason[k]!.trim() });
                            setReason((r) => ({ ...r, [k]: "" }));
                          }}
                        >
                          Switch on
                        </button>
                      </div>
                    ) : (
                      <span className="muted">view only</span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
    </div>
  );
}

/* ---------------------------------------------------------- recent changes */

function RecentChanges() {
  const log = trpc.admin.auditLog.useQuery({ actions: SELLER_RULE_ACTIONS, limit: 50 });

  return (
    <div className="op-sec">
      <h2>Recent changes</h2>
      <p className="lede">
        Who changed what, when, and why. Every licence decision, badge decision, category switch and product
        reclassification is recorded in the same transaction as the change itself and cannot be edited afterwards.
      </p>
      {log.isLoading ? (
        <p className="op-note">Loading…</p>
      ) : !log.data?.length ? (
        <div className="op-empty">No changes yet.</div>
      ) : (
        <table className="op-table">
          <thead>
            <tr>
              <th>When</th>
              <th>Who</th>
              <th>What</th>
              <th>Subject</th>
              <th>Change</th>
              <th>Reason</th>
            </tr>
          </thead>
          <tbody>
            {log.data.map((e) => (
              <tr key={e.id}>
                <td className="muted">{when(e.createdAt)}</td>
                <td>
                  {e.actorEmail}
                  <div className="muted">{e.actorRole.replace("_", " ")}</div>
                </td>
                <td>{ACTION_LABEL[e.action] ?? e.action}</td>
                <td className="muted">{e.subjectId}</td>
                <td className="muted">
                  <code>{JSON.stringify(e.before)}</code> → <code>{JSON.stringify(e.after)}</code>
                </td>
                <td className="muted">{e.note ?? "—"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
