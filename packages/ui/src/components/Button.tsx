import type { ButtonHTMLAttributes } from "react";

export type ButtonVariant = "primary" | "accent" | "secondary" | "ghost";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: ButtonVariant;
  /** Matches the prototype's `.btn-sm` — use for dense contexts like reorder rows. */
  size?: "md" | "sm";
}

/**
 * One terracotta (`accent`) action per screen — see CLAUDE.md brand tokens.
 * `primary` (deep green) is the default confident action; `secondary`/`ghost`
 * are lower-emphasis alternatives, matching the Design System's button demo.
 */
export function Button({ variant = "primary", size = "md", className, ...props }: ButtonProps) {
  const classes = ["btn", `btn-${variant}`, size === "sm" ? "btn-sm" : "", className]
    .filter(Boolean)
    .join(" ");
  return <button className={classes} {...props} />;
}
