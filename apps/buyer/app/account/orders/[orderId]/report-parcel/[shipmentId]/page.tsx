"use client";

import { use, useState } from "react";
import Link from "next/link";
import { trpc } from "@afrimart/api-client";
import { ArrowRightIcon, CheckIcon, ChevronLeftIcon, PageHeader } from "@afrimart/ui";
import { Summary, longDate, tickIcon } from "../../../report-kit";

/**
 * AfriMart Buyer - Boxes Tracking and Account.html — "Report a problem",
 * parcel level (QC-3): the parcel hasn't arrived.
 *
 * No photo, because there is nothing to photograph. Offered only once the
 * expected date has passed or tracking says delivered, and always reviewed by
 * a person: the server enforces both, this page only asks nicely first. The
 * first step is the prototype's "have a quick look nearby" because parcels
 * often turn up with a neighbour, and a report that did not need to be made
 * costs the buyer a wait and us a review.
 */

const LOOKS = [
  {
    key: "Neighbours",
    label: "With a neighbour",
    hint: "Carriers often leave parcels next door or across the hall",
    icon: (
      <>
        <path d="M3 11l5-4 5 4M4 10v9h8v-9M13 13l4-3 4 3M14 12v7h6v-7" strokeLinecap="round" strokeLinejoin="round" />
      </>
    ),
  },
  {
    key: "Mailroom",
    label: "In the building mailroom",
    hint: "Or with the front desk, concierge or leasing office",
    icon: (
      <>
        <rect x="3" y="4" width="18" height="16" rx="2" />
        <path d="M3 10h18M8 14.5h8" strokeLinecap="round" />
      </>
    ),
  },
  {
    key: "Safe place",
    label: "In a safe place",
    hint: "Porch, side door, behind a gate or in a parcel locker",
    icon: (
      <>
        <path d="M6 21V4a1 1 0 0 1 1-1h10a1 1 0 0 1 1 1v17M3 21h18" strokeLinecap="round" strokeLinejoin="round" />
        <circle cx="14.5" cy="12" r=".9" fill="currentColor" />
      </>
    ),
  },
] as const;

const TITLES = ["Before you report", "Anything else?"];

export default function ReportParcelPage({ params }: { params: Promise<{ orderId: string; shipmentId: string }> }) {
  const { orderId, shipmentId } = use(params);
  const order = trpc.orders.detail.useQuery({ orderId });
  const utils = trpc.useUtils();
  const submit = trpc.claims.submitParcelReport.useMutation({ onSuccess: () => utils.orders.invalidate() });

  const [step, setStep] = useState(1);
  const [looked, setLooked] = useState<Set<string>>(new Set());
  const [note, setNote] = useState("");

  const parcel = order.data?.parcels.find((p) => p.shipmentId === shipmentId);
  if (order.isLoading) return <p className="od-note">Loading…</p>;
  if (!parcel) return <p className="od-note">We couldn&apos;t find that parcel.</p>;

  if (parcel.parcelClaim) {
    return (
      <div className="rstep">
        <p className="rlede">You&apos;ve already reported this parcel. We&apos;ll update you as soon as we have news.</p>
        <Link className="btn btn-primary" href={`/account/orders/${orderId}`}>
          Back to your order
        </Link>
      </div>
    );
  }
  if (parcel.parcelReportBlock) {
    return (
      <>
        <div className="mobile-chrome">
          <PageHeader back={`/account/orders/${orderId}`} eyebrow="Report a problem" title="Not just yet" />
        </div>
        <div className="rstep">
          <p className="rlede">{parcel.parcelReportBlock}</p>
          <Link className="btn btn-primary" href={`/account/orders/${orderId}`}>
            Back to your order
          </Link>
        </div>
      </>
    );
  }

  const checked = [...looked].sort();

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
        <p className="lede">We&apos;ll look into it with the carrier and update you by email.</p>
        <Summary
          rows={[
            ["Reference", submit.data.ref],
            ["Parcel", `From ${parcel.storeName}`],
            ["Reason", "Parcel hasn't arrived"],
            ["Status", "Submitted"],
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

  function send() {
    // What the buyer already checked travels with the note, so the person
    // reviewing does not ask them to look in the same places again.
    const text = [checked.length ? `Checked: ${checked.join(", ")}.` : "", note.trim()].filter(Boolean).join(" ");
    submit.mutate({ shipmentId, note: text || undefined });
  }

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader
          back={step > 1 ? () => setStep(1) : `/account/orders/${orderId}`}
          eyebrow={`Report a problem · Step ${step} of 2`}
          title={TITLES[step - 1]}
        />
      </div>

      <div className="rstep">
        <div className="od-dt">
          {step > 1 ? (
            <button type="button" className="dback" onClick={() => setStep(1)}>
              <ChevronLeftIcon /> Back
            </button>
          ) : (
            <Link href={`/account/orders/${orderId}`} className="dback">
              <ChevronLeftIcon /> Your order
            </Link>
          )}
          <div className="eyebrow">Report a problem · Step {step} of 2</div>
          <h1 className="serif">{TITLES[step - 1]}</h1>
        </div>

        {step === 1 ? (
          <>
            <p className="rlede">Parcels often turn up close by. Have a quick look in these places first.</p>
            <div className="reasons looks">
              {LOOKS.map((x) => (
                <button
                  type="button"
                  key={x.key}
                  className={`reason${looked.has(x.key) ? " on" : ""}`}
                  aria-pressed={looked.has(x.key)}
                  onClick={() =>
                    setLooked((s) => {
                      const n = new Set(s);
                      if (n.has(x.key)) n.delete(x.key);
                      else n.add(x.key);
                      return n;
                    })
                  }
                >
                  <span className="ic">
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
                      {x.icon}
                    </svg>
                  </span>
                  <span className="m">
                    <span className="t">{x.label}</span>
                    <span className="s">{x.hint}</span>
                  </span>
                  <span className="ck">{tickIcon}</span>
                </button>
              ))}
            </div>
          </>
        ) : (
          <>
            <p className="rlede">Add anything that might help us find it, like a gate code or where parcels usually go.</p>
            <div className="phhead">
              <span className="eyebrow">Note</span>
              <span className="opt">Optional</span>
            </div>
            <div className="pnote">
              <textarea
                rows={4}
                maxLength={300}
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="e.g. Parcels usually go to the front desk in the lobby"
                aria-label="Note"
              />
            </div>
            <Summary
              rows={[
                ["Parcel", `From ${parcel.storeName}`],
                [
                  "Tracking",
                  parcel.status === "delivered"
                    ? "Shows delivered"
                    : parcel.estimatedDelivery
                      ? `Expected ${longDate(parcel.estimatedDelivery)}`
                      : "Late",
                ],
                ["Checked", checked.length ? checked.join(", ") : "—"],
                ["Order", order.data!.ref],
              ]}
            />
            {submit.isError && <div className="op-err rp-err">{submit.error.message}</div>}
          </>
        )}
      </div>

      <div className="rp-bar">
        <button
          type="button"
          className={`bigbtn ${step < 2 ? "green" : "accent"}`}
          disabled={submit.isPending}
          onClick={() => (step < 2 ? (setStep(2), window.scrollTo({ top: 0 })) : send())}
        >
          {step < 2 ? (
            <>
              I&apos;ve looked — continue <ArrowRightIcon />
            </>
          ) : submit.isPending ? (
            "Sending…"
          ) : (
            "Submit report"
          )}
        </button>
      </div>
    </>
  );
}
