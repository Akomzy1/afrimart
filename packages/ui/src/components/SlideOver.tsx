"use client";

import type { ReactNode } from "react";
import { CloseIcon } from "../icons";

export interface SlideOverProps {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
}

/** Right-edge drawer used for filters (and reusable anywhere else a slide-over is needed). */
export function SlideOver({ open, title, onClose, children, footer }: SlideOverProps) {
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
