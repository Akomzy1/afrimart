import type { ReactNode } from "react";
import { CheckIcon } from "@afrimart/ui";

/**
 * Shared pieces of the order detail and the two report flows (QC-3).
 * AfriMart Buyer - Boxes Tracking and Account.html — delivered order, report a
 * problem, parcel hasn't arrived.
 */

export const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

export const longDate = (iso: string | Date) =>
  new Date(iso).toLocaleDateString("en-US", { month: "short", day: "numeric" });

const svg = (children: ReactNode) => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true">
    {children}
  </svg>
);

/**
 * The five reasons a buyer can choose, in the prototype's order. `id` is the
 * server's reason; the labels are the buyer's words ("Not as described" is
 * stored as wrong_item). Late delivery is deliberately not here: it is never
 * offered to a buyer (QC-3).
 */
export const REASONS = [
  {
    id: "damaged",
    label: "Damaged",
    hint: "Crushed, torn or leaking",
    icon: svg(
      <>
        <path d="M4 9h16v11H4zM3 5h18v4H3z" strokeLinejoin="round" />
        <path d="M11 9l2 4-2 3 1 4" strokeLinecap="round" strokeLinejoin="round" />
      </>,
    ),
  },
  {
    id: "spoiled",
    label: "Spoiled or expired",
    hint: "Gone off, or past its date",
    icon: svg(
      <>
        <rect x="4" y="5" width="16" height="15" rx="2" />
        <path d="M4 10h16M9 3v4M15 3v4M10 13l4 4M14 13l-4 4" strokeLinecap="round" />
      </>,
    ),
  },
  {
    id: "wrong_item",
    label: "Not as described",
    hint: "Wrong item, size or variety",
    icon: svg(
      <>
        <circle cx="12" cy="12" r="9" />
        <path d="M9.5 9.5a2.5 2.5 0 0 1 4 2c0 1.5-2 2-2 3.5M12 17.5h.01" strokeLinecap="round" />
      </>,
    ),
  },
  {
    id: "inauthentic",
    label: "Doesn't seem genuine",
    hint: "Packaging or taste isn't right",
    icon: svg(
      <>
        <path d="M12 3l8 3v6c0 4.5-3.4 8-8 9-4.6-1-8-4.5-8-9V6l8-3z" strokeLinejoin="round" />
        <path d="M12 8v5M12 16h.01" strokeLinecap="round" />
      </>,
    ),
  },
  {
    id: "missing_items",
    label: "Missing from the box",
    hint: "Ordered, but not in the parcel",
    icon: svg(
      <>
        <path d="M4 9h16v11H4zM3 5h18v4H3z" strokeLinejoin="round" />
        <path d="M9 14.5h6" strokeLinecap="round" />
      </>,
    ),
  },
] as const;

export type ReasonId = (typeof REASONS)[number]["id"];

export const reasonLabel = (id: string) =>
  id === "not_delivered" ? "Parcel hasn't arrived" : (REASONS.find((r) => r.id === id)?.label ?? id);

export const flagIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true">
    <path d="M5 21V4M5 4h11l-2 4 2 4H5" strokeLinecap="round" strokeLinejoin="round" />
  </svg>
);

export const tickIcon = <CheckIcon strokeWidth={2.6} />;

export interface ClaimLike {
  id: string;
  ref: string;
  kind: "item" | "parcel";
  reason: string;
  amountCents: number;
  stage: "review" | "refunded" | "declined";
  createdAt: string | Date;
}

/**
 * A report as the buyer sees it: submitted, under review, then refunded. The
 * stage is the claim's real state — "Refunded" appears only once the money has
 * gone — not a timer.
 */
export function ClaimCard({ claim, what }: { claim: ClaimLike; what: string }) {
  const third = claim.stage === "declined" ? "Not approved" : "Refunded";
  const idx = claim.stage === "review" ? 1 : 2;
  const steps = [
    { label: "Submitted", date: longDate(claim.createdAt) },
    { label: "Under review", date: "" },
    { label: third, date: "" },
  ];
  const title =
    claim.stage === "refunded"
      ? `Refunded ${money(claim.amountCents)}`
      : claim.stage === "declined"
        ? "We couldn't approve this report"
        : "We're reviewing your report";
  const note =
    claim.stage === "refunded"
      ? "Sent to your original payment method. It can take 5–10 business days to show, depending on your bank."
      : claim.stage === "declined"
        ? "If you think we've got this wrong, reply to the email we sent you and we'll look again."
        : "Once it's confirmed, we'll refund you promptly to your original payment method. We'll email you at each step.";

  return (
    <div className="claim" data-stage={claim.stage}>
      <div className="eyebrow">Your report · {claim.ref}</div>
      <h3 className="serif">{title}</h3>
      <div className="what">{what}</div>
      <div className="ctrack">
        {steps.map((s, i) => (
          <div
            className={`cs ${claim.stage === "refunded" ? "done" : i < idx ? "done" : i === idx ? "now" : ""}`}
            key={s.label}
          >
            <div className="l">{s.label}</div>
            <div className="d">{s.date || " "}</div>
          </div>
        ))}
      </div>
      <div className="note">
        <span>{note}</span>
      </div>
    </div>
  );
}

/** The summary shown on the "report received" screen. */
export function Summary({ rows }: { rows: [string, string][] }) {
  return (
    <div className="gsummary">
      {rows.map(([k, v]) => (
        <div className="r" key={k}>
          <span>{k}</span>
          <span className="v">{v}</span>
        </div>
      ))}
    </div>
  );
}
