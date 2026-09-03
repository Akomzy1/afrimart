import type { ReactNode } from "react";
import { CheckIcon } from "../icons";

export type BadgeKind = "verified" | "fresh" | "new" | "sale";

export interface BadgeProps {
  kind: BadgeKind;
  children: ReactNode;
}

/** Trust and merchandising marks — verified seller, freshness, new, sale. */
export function Badge({ kind, children }: BadgeProps) {
  return (
    <span className={`badge ${kind}`}>
      {kind === "verified" && <CheckIcon />}
      {children}
    </span>
  );
}

export interface SealProps {
  icon: ReactNode;
  label: string;
}

/** The understated "mark of trust" seal — e.g. Verified Seller, Freshness Promise. */
export function Seal({ icon, label }: SealProps) {
  return (
    <span className="seal">
      {icon}
      <span className="lbl">{label}</span>
    </span>
  );
}
