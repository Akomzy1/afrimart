import type { ElementType, ReactNode } from "react";
import { ChevronLeftIcon } from "../icons";

export interface PageHeaderProps {
  eyebrow?: string;
  title?: string;
  /** Back-button target. Pass a string for a plain `<a href>`, or use `backAs` for Next's Link/router.back(). */
  back?: string | (() => void);
  backAs?: ElementType;
  /** Right-side slot — typically a CartButton. */
  right?: ReactNode;
}

/** The back-button-and-title header used on shop, search, and product detail. */
export function PageHeader({ eyebrow, title, back, backAs: BackComp = "a", right }: PageHeaderProps) {
  return (
    <div className="pageheader">
      {back &&
        (typeof back === "string" ? (
          <BackComp href={back} className="back" aria-label="Back">
            <ChevronLeftIcon />
          </BackComp>
        ) : (
          <button type="button" className="back" onClick={back} aria-label="Back">
            <ChevronLeftIcon />
          </button>
        ))}
      <div className="ttl">
        {eyebrow && <div className="eyebrow">{eyebrow}</div>}
        {title && <h2>{title}</h2>}
      </div>
      {right}
    </div>
  );
}
