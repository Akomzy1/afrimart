"use client";

import { Suspense, use, useMemo, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { trpc } from "@afrimart/api-client";
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon, PageHeader, ProductGlyph, fileToJpegDataUrl } from "@afrimart/ui";
import { glyphForCategory } from "../../../../../../lib/glyph";
import { REASONS, Summary, money, reasonLabel, tickIcon, type ReasonId } from "../../../report-kit";

/**
 * AfriMart Buyer - Boxes Tracking and Account.html — "Report a problem",
 * item level (QC-3). Three steps: which items, what happened, a photo. The
 * photo is required; for "missing from the box" the prompt asks for what did
 * arrive, because that is what gets compared with the seller's packing photo.
 *
 * Nothing here decides the outcome. The server checks the parcel is the
 * buyer's, that it has arrived, that the items are not already reported and
 * that the photo is a real photo, and says what happens next.
 */
export default function ReportPage({ params }: { params: Promise<{ orderId: string; shipmentId: string }> }) {
  const { orderId, shipmentId } = use(params);
  return (
    <Suspense fallback={<p className="od-note">Loading…</p>}>
      <ReportFlow orderId={orderId} shipmentId={shipmentId} />
    </Suspense>
  );
}

const TITLES = ["Which items?", "What happened?", "Add a photo"];

function ReportFlow({ orderId, shipmentId }: { orderId: string; shipmentId: string }) {
  const preselect = useSearchParams().get("item");
  const order = trpc.orders.detail.useQuery({ orderId });
  const utils = trpc.useUtils();
  const submit = trpc.claims.submitItemReport.useMutation({ onSuccess: () => utils.orders.invalidate() });

  const [step, setStep] = useState(1);
  const [picked, setPicked] = useState<Set<string> | null>(null);
  const [reason, setReason] = useState<ReasonId | null>(null);
  const [photo, setPhoto] = useState<string | null>(null);
  const [photoError, setPhotoError] = useState<string | null>(null);

  const parcel = order.data?.parcels.find((p) => p.shipmentId === shipmentId);
  // Items already in an open report cannot be chosen again.
  const free = useMemo(() => new Set(parcel?.items.filter((i) => !i.claim).map((i) => i.id) ?? []), [parcel]);
  const selected = picked ?? new Set(preselect && free.has(preselect) ? [preselect] : []);

  if (order.isLoading) return <p className="od-note">Loading…</p>;
  if (!parcel) return <p className="od-note">We couldn&apos;t find that parcel.</p>;
  if (parcel.itemReportBlock) {
    return (
      <>
        <div className="mobile-chrome">
          <PageHeader back={`/account/orders/${orderId}`} eyebrow="Report a problem" title="Not just yet" />
        </div>
        <div className="rstep">
          <p className="rlede">{parcel.itemReportBlock}</p>
          <Link className="btn btn-primary" href={`/account/orders/${orderId}`}>
            Back to your order
          </Link>
        </div>
      </>
    );
  }

  const chosen = parcel.items.filter((i) => selected.has(i.id));
  const itemText = chosen.map((i) => `${i.name} ×${i.quantity}`).join(", ");

  if (submit.isSuccess) {
    return (
      <div className="confirm rp-done">
        <div className="seal">
          <div className="ring" />
          <div className="core">
            <CheckIcon strokeWidth={2.2} />
          </div>
        </div>
        <div className="eyebrow">Report received</div>
        <h1>Thank you for letting us know</h1>
        <p className="lede">
          {submit.data.refunded
            ? `We've refunded ${money(submit.data.amountCents)} to your original payment method. We'll email you the details.`
            : "Our team is looking at your report now. Once it's confirmed, we'll refund you promptly to your original payment method. We'll email you at each step."}
        </p>
        <Summary
          rows={[
            ["Reference", submit.data.ref],
            ["Items", itemText],
            ["Reason", reasonLabel(reason!)],
            ["Status", submit.data.refunded ? "Refunded" : "Submitted"],
          ]}
        />
        <div className="done">
          <Link className="doneb" href={`/account/orders/${orderId}`}>
            Back to your order
          </Link>
        </div>
      </div>
    );
  }

  const ready = step === 1 ? selected.size > 0 : step === 2 ? reason !== null : photo !== null;
  const missing = reason === "missing_items";

  function toggle(id: string) {
    const next = new Set(selected);
    if (next.has(id)) next.delete(id);
    else next.add(id);
    setPicked(next);
  }

  async function choosePhoto(file: File | undefined) {
    if (!file) return;
    setPhotoError(null);
    try {
      setPhoto(await fileToJpegDataUrl(file));
    } catch {
      setPhotoError("We couldn't read that photo. Please try another.");
    }
  }

  function next() {
    if (step < 3) {
      setStep(step + 1);
      window.scrollTo({ top: 0 });
      return;
    }
    if (photo && reason) {
      submit.mutate({ shipmentId, itemIds: [...selected], reason, photo });
    }
  }

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader
          back={step > 1 ? () => setStep(step - 1) : `/account/orders/${orderId}`}
          eyebrow={`Report a problem · Step ${step} of 3`}
          title={TITLES[step - 1]}
        />
      </div>

      <div className="rstep">
        <div className="od-dt">
          {step > 1 ? (
            <button type="button" className="dback" onClick={() => setStep(step - 1)}>
              <ChevronLeftIcon /> Back
            </button>
          ) : (
            <Link href={`/account/orders/${orderId}`} className="dback">
              <ChevronLeftIcon /> Your order
            </Link>
          )}
          <div className="eyebrow">Report a problem · Step {step} of 3</div>
          <h1 className="serif">{TITLES[step - 1]}</h1>
        </div>

        {step === 1 && (
          <>
            <p className="rlede">Sorry something wasn&apos;t right. Choose the items affected and we&apos;ll take a look.</p>
            {parcel.items.map((i) => (
              <button
                type="button"
                key={i.id}
                className={`pick${selected.has(i.id) ? " on" : ""}`}
                disabled={!free.has(i.id)}
                aria-pressed={selected.has(i.id)}
                onClick={() => toggle(i.id)}
              >
                <span className="th">
                  <ProductGlyph kind={glyphForCategory(i.category)} />
                </span>
                <span className="m">
                  <span className="nm">
                    {i.name} <small>×{i.quantity}</small>
                  </span>
                  <span className="sl">{free.has(i.id) ? i.packSize : "Already reported"}</span>
                </span>
                <span className="ck">{tickIcon}</span>
              </button>
            ))}
          </>
        )}

        {step === 2 && (
          <>
            <p className="rlede">Choose the reason that fits best.</p>
            <div className="reasons">
              {REASONS.map((r) => (
                <button
                  type="button"
                  key={r.id}
                  className={`reason${reason === r.id ? " on" : ""}`}
                  aria-pressed={reason === r.id}
                  onClick={() => setReason(r.id)}
                >
                  <span className="ic">{r.icon}</span>
                  <span className="m">
                    <span className="t">{r.label}</span>
                    <span className="s">{r.hint}</span>
                  </span>
                  <span className="rdot" />
                </button>
              ))}
            </div>
          </>
        )}

        {step === 3 && (
          <>
            <p className="rlede">
              {missing
                ? "Photograph what did arrive. We'll compare it with the photo the seller took when packing."
                : "A clear photo helps us sort this out quickly. Show the item and any label or packaging."}
            </p>
            <div className="phhead">
              <span className="eyebrow">Photo</span>
              <span className="req">Required</span>
            </div>
            <input
              id="rp-file"
              type="file"
              accept="image/*"
              hidden
              onChange={(e) => {
                void choosePhoto(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            {photo ? (
              <div className="upl-prev" style={{ backgroundImage: `url(${photo})` }} role="img" aria-label="The photo you added">
                <span className="ok">
                  <CheckIcon strokeWidth={2.6} /> Photo added
                </span>
                <label htmlFor="rp-file" className="chg">
                  Change photo
                </label>
              </div>
            ) : (
              <label htmlFor="rp-file" className="upl">
                <span className="ic">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
                    <rect x="3" y="7" width="18" height="13" rx="2" />
                    <path d="M8 7l1.5-2.5h5L16 7" strokeLinejoin="round" />
                    <circle cx="12" cy="13.5" r="3.5" />
                  </svg>
                </span>
                <span className="t">{missing ? "Photograph what arrived" : "Add a photo"}</span>
                <span className="s">Take one now or choose from your library</span>
              </label>
            )}
            {photoError && <div className="op-err rp-err">{photoError}</div>}
            <Summary rows={[["Items", itemText], ["Reason", reasonLabel(reason!)], ["Order", order.data!.ref]]} />
            {submit.isError && <div className="op-err rp-err">{submit.error.message}</div>}
          </>
        )}
      </div>

      <div className="rp-bar">
        <button
          type="button"
          className={`bigbtn ${step < 3 ? "green" : "accent"}`}
          disabled={!ready || submit.isPending}
          onClick={next}
        >
          {step < 3 ? (
            <>
              Continue <ArrowRightIcon />
            </>
          ) : submit.isPending ? (
            "Sending…"
          ) : (
            "Submit report"
          )}
        </button>
        {step === 3 && <div className="rbar-hint">Only your photo and the details above are sent. Where it was taken is not kept.</div>}
      </div>
    </>
  );
}
