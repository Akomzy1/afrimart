import type { ButtonHTMLAttributes } from "react";

export interface ChipProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** `on` = selected cuisine/filter. `suggest` = dashed, amber — Cook agent suggestions only. */
  variant?: "default" | "on" | "suggest";
}

/** Cuisine filters and Cook-agent dish suggestions. Never a gate — see AGT-1. */
export function Chip({ variant = "default", className, ...props }: ChipProps) {
  const classes = ["chip", variant !== "default" ? variant : "", className].filter(Boolean).join(" ");
  return <button className={classes} {...props} />;
}
