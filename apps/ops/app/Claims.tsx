"use client";

import { useState } from "react";
import { trpc, type RouterOutputs } from "@afrimart/api-client";

/**
 * QC-3 / QC-8 — buyer reports waiting on a person.
 *
 * What a reviewer needs to decide one is on the row: what was reported, the
 * buyer's photo, and for "missing from the box" the seller's packing photo
 * (QC-2) beside it, because that comparison is the whole question. Approving a
 * claim that went to review is what refunds the buyer; the cost is then
 * recovered from whoever caused it, which is the second choice made here.
 *
 * Both photos are served from the backend and are stripped of location data
 * before they are stored, so there is nothing in them to be careful about.
 */

const API_ORIGIN = new URL(process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc").origin;
const photo = (path: string) => `${API_ORIGIN}${path}`;
const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const when = (d: Date | string) => new Date(d).toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" });

const REASON: Record<string, string> = {
  damaged: "Damaged",
  spoiled: "Spoiled or expired",
  wrong_item: "Not as described",
  inauthentic: "Doesn't seem genuine",
  missing_items: "Missing from the box",
  not_delivered: "Parcel hasn't arrived",
};

type Target = "seller" | "carrier" | "platform";

export function Claims({ canResolve }: { canResolve: boolean }) {
  const utils = trpc.useUtils();
  const claims = trpc.admin.refundClaims.useQuery();
  const resolve = trpc.admin.resolveRefundClaim.useMutation({
    onSuccess: () => {
      utils.admin.refundClaims.invalidate();
      utils.admin.reconciliation.invalidate();
      utils.admin.auditLog.invalidate();
    },
  });
  const [target, setTarget] = useState<Record<string, Target>>({});
  const [recovered, setRecovered] = useState<Record<string, string>>({});
  const [note, setNote] = useState<Record<string, string>>({});

  if (claims.isLoading) return <p className="op-note">Loading reports…</p>;
  if (claims.isError) return <p className="op-note">Couldn&apos;t reach the backend.</p>;

  const waiting = claims.data?.filter((c) => c.status === "manual_review") ?? [];
  const recorded = claims.data?.filter((c) => c.status !== "manual_review") ?? [];

  return (
    <div className="op-sec">
      <h2>Buyer reports</h2>
      <p className="lede">
        QC-3 — reports of items that arrived wrong or parcels that did not arrive. A parcel that never arrived and
        anything flagged for a closer look waits here for a person. Approving one refunds the buyer; then say where the
        cost is recovered from. A &ldquo;missing from the box&rdquo; report is judged against the seller&apos;s packing
        photo, shown beside the buyer&apos;s.
      </p>

      {!waiting.length ? (
        <div className="op-empty">No reports waiting.</div>
      ) : (
        <ClaimTable
          rows={waiting}
          canResolve={canResolve}
          target={target}
          setTarget={setTarget}
          recovered={recovered}
          setRecovered={setRecovered}
          note={note}
          setNote={setNote}
          resolve={resolve}
        />
      )}

      <h2 style={{ marginTop: 22 }}>Approved refunds</h2>
      <p className="lede">
        Assign responsibility and record the total recovered so far. An unpaid seller payout stays on hold until
        the seller-funded amount has been recovered.
      </p>
      {!recorded.length ? (
        <div className="op-empty">Nothing yet.</div>
      ) : (
        <ClaimTable
          rows={recorded}
          canResolve={canResolve}
          target={target}
          setTarget={setTarget}
          recovered={recovered}
          setRecovered={setRecovered}
          note={note}
          setNote={setNote}
          resolve={resolve}
        />
      )}
    </div>
  );
}

type Row = RouterOutputs["admin"]["refundClaims"][number];

/**
 * The photos on a report are private (the buyer's can show their address), so
 * they are not loaded with the table. Opening them is a deliberate step, and
 * each one opened is written to the audit log with who opened it. The links that
 * come back are signed and last minutes, so a copied link soon stops working.
 */
function ClaimPhotos({ claim: c }: { claim: Row }) {
  const open = trpc.admin.claimPhotoLinks.useMutation();
  const links = open.data;
  const thumb = { objectFit: "cover", borderRadius: 4, border: "1px solid var(--line)" } as const;
  const hasAny = c.hasPhoto || c.hasPackingPhoto;

  return (
    <div className="op-actions">
      {!links && hasAny && (
        <button type="button" className="op-btn" disabled={open.isPending} onClick={() => open.mutate({ claimId: c.id })}>
          {open.isPending ? "Opening…" : "Show photos"}
        </button>
      )}
      {!links && hasAny && <div className="muted">Opening a photo is recorded.</div>}
      {open.isError && <div className="op-note">{open.error.message}</div>}

      {c.hasPhoto ? (
        links?.photo ? (
          <a href={photo(links.photo)} target="_blank" rel="noreferrer">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img src={photo(links.photo)} alt="The buyer's photo" width={96} height={72} style={thumb} />
            <div className="muted">Buyer&apos;s photo</div>
          </a>
        ) : null
      ) : c.kind === "item" ? (
        <span className="muted">no buyer photo</span>
      ) : null}

      {c.kind === "item" || c.hasPackingPhoto ? (
        c.hasPackingPhoto ? (
          links?.packingPhoto ? (
            <a href={photo(links.packingPhoto)} target="_blank" rel="noreferrer">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={photo(links.packingPhoto)} alt="The seller's packing photo" width={96} height={72} style={thumb} />
              <div className="muted">Seller packed{c.packingPhotoAt ? ` · ${when(c.packingPhotoAt)}` : ""}</div>
            </a>
          ) : null
        ) : (
          <span className="op-pill bad">no packing photo on record</span>
        )
      ) : null}
    </div>
  );
}

function ClaimTable({
  rows,
  canResolve,
  target,
  setTarget,
  recovered,
  setRecovered,
  note,
  setNote,
  resolve,
}: {
  rows: Row[];
  canResolve: boolean;
  target: Record<string, Target>;
  setTarget: React.Dispatch<React.SetStateAction<Record<string, Target>>>;
  recovered: Record<string, string>;
  setRecovered: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  note: Record<string, string>;
  setNote: React.Dispatch<React.SetStateAction<Record<string, string>>>;
  resolve: ReturnType<typeof trpc.admin.resolveRefundClaim.useMutation>;
}) {
  return (
    <table className="op-table">
      <thead>
        <tr>
          <th>Report</th>
          <th>What</th>
          <th>Photos</th>
          <th className="num">Amount</th>
          <th>Cost lands on</th>
          <th>Decision</th>
        </tr>
      </thead>
      <tbody>
        {rows.map((c) => {
          const chosen = target[c.id] ?? (c.recoveryTarget as Target | null) ?? "seller";
          return (
            <tr key={c.id}>
              <td>
                {c.ref}
                <div className="muted">{c.buyerEmail}</div>
                <div className="muted">{when(c.createdAt)}</div>
              </td>
              <td>
                <span className="op-pill warn">{REASON[c.reason] ?? c.reason}</span>
                <div className="muted">
                  {c.kind === "parcel"
                    ? `Parcel from ${c.storeName ?? "the seller"} · now ${c.parcelStatus ?? "unknown"}`
                    : c.items.map((i) => `${i.name} ×${i.quantity}`).join(", ")}
                </div>
                {c.note ? <div className="muted">“{c.note}”</div> : null}
              </td>
              <td>
                <ClaimPhotos claim={c} />
              </td>
              <td className="num">{money(c.amountCents)}</td>
              <td>
                {canResolve ? (
                  <>
                    <select className="op-select" value={chosen} onChange={(e) => setTarget((t) => ({ ...t, [c.id]: e.target.value as Target }))}>
                      <option value="seller">seller</option>
                      <option value="carrier">carrier</option>
                      <option value="platform">platform</option>
                    </select>
                    <input
                      className="op-input"
                      style={{ marginTop: 6 }}
                      aria-label="Total recovered in dollars"
                      placeholder="Total recovered ($)"
                      inputMode="decimal"
                      value={recovered[c.id] ?? (c.recoveredCents ? (c.recoveredCents / 100).toFixed(2) : "")}
                      onChange={(e) => setRecovered((r) => ({ ...r, [c.id]: e.target.value }))}
                    />
                  </>
                ) : (
                  <span className="muted">{c.recoveryTarget ?? "—"}</span>
                )}
              </td>
              <td>
                {!canResolve ? (
                  <span className="muted">view only</span>
                ) : (
                  <div>
                    <input
                      className="op-input"
                      placeholder="Note"
                      value={note[c.id] ?? ""}
                      onChange={(e) => setNote((n) => ({ ...n, [c.id]: e.target.value }))}
                    />
                    <div className="op-actions" style={{ marginTop: 6 }}>
                      <button
                        type="button"
                        className="op-btn primary"
                        disabled={resolve.isPending}
                        onClick={() =>
                          resolve.mutate({
                            claimId: c.id,
                            decision: "approve",
                            recoveryTarget: chosen,
                            recoveredCents: recovered[c.id] === undefined ? c.recoveredCents : Math.round(Number(recovered[c.id]) * 100),
                            note: note[c.id]?.trim() || undefined,
                          })
                        }
                      >
                        {c.refundedAt ? "Record recovery" : "Approve and refund"}
                      </button>
                      {c.status === "manual_review" && !c.refundedAt && (
                        <button
                          type="button"
                          className="op-btn danger"
                          disabled={resolve.isPending}
                          onClick={() => resolve.mutate({ claimId: c.id, decision: "reject", note: note[c.id]?.trim() || undefined })}
                        >
                          Reject
                        </button>
                      )}
                    </div>
                    {resolve.variables?.claimId === c.id && resolve.isError ? <div className="op-err">{resolve.error.message}</div> : null}
                  </div>
                )}
              </td>
            </tr>
          );
        })}
      </tbody>
    </table>
  );
}
