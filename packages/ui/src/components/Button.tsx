import type { ElementType } from "react";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";

export interface ButtonProps {
  variant?: ButtonVariant;
  /** Matches the prototype's `.btn-sm` — use for dense contexts like reorder rows. */
  size?: "md" | "sm";
  className?: string;
  /** Render as Next's Link (or any element) instead of a `<button>` — for nav actions like "Start shopping". */
  as?: ElementType;
  [key: string]: unknown;
}

/**
 * One amber (`accent`) action per screen — see CLAUDE.md brand tokens.
 * `primary` (deep green) is the default confident action; `secondary`/`ghost`
 * are lower-emphasis alternatives, matching the Design System's button demo.
 */
export function Button({ variant = "primary", size = "md", className, as: Comp = "button", ...props }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", className]
    .filter(Boolean)
    .join(" ");
  return <Comp className={classes} {...props} />;
}
