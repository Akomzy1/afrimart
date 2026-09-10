"use client";

import type { ReactNode } from "react";
import { CloseIcon } from "../icons";

export interface SlideOverProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  /**
   * Render as a persistent sidebar instead of a drawer. `open`, `onClose`, and
   * `footer` are all meaningless in this mode and are ignored: there is no
   * scrim, no dialog semantics, no close button, and no footer — the panel is
   * simply part of the page.
   */
  pinned?: boolean;
}

/** Right-edge drawer used for filters (and reusable anywhere else a slide-over is needed). */
export function SlideOver({ open, title, onClose, children, footer, pinned }: SlideOverProps) {
  if (pinned) {
    return (
      <aside className="slideover pinned" aria-label={title}>
        <div className="so-head">
          <h3>{title}</h3>
        </div>
        <div className="so-body">{children}</div>
      </aside>
    );
  }

  return (
    <>
      <div className={`scrim${open ? " on" : ""}`} onClick={onClose} aria-hidden="true" />
      <aside className={`slideover${open ? " on" : ""}`} role="dialog" aria-modal="true" aria-label={title}>
        <div className="so-head">
          <h3>{title}</h3>
          <button type="button" className="x" onClick={onClose} aria-label="Close">
            <CloseIcon />
          </button>
        </div>
        <div className="so-body">{children}</div>
        {footer && <div className="so-foot">{footer}</div>}
      </aside>
    </>
  );
}
