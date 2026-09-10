"use client";

import { useState, type AnchorHTMLAttributes, type ElementType, type ReactNode } from "react";
import { SearchIcon, CartIcon } from "../icons";
import { Logo } from "./Logo";

export interface DesktopNavProps {
  /** The Shop / Cook / Boxes / Orders links — pass DesktopNavLink children so the app owns routing and active state. */
  children: ReactNode;
  cartCount?: number;
  /** Next's Link (or any anchor-compatible component) for client-side navigation. Defaults to a plain `<a>`. */
  as?: ElementType;
  homeHref?: string;
  cartHref?: string;
  /** Fired on Enter with a trimmed, non-empty query. */
  onSearch?: (query: string) => void;
  searchPlaceholder?: string;
}

/**
 * App-wide desktop chrome, shown only at >=1200px (see `.dnav` in global.css),
 * where it replaces both the mobile header and the bottom tab bar.
 */
export function DesktopNav({
  children,
  cartCount = 0,
  as: Comp = "a",
  homeHref = "/",
  cartHref = "/cart",
  onSearch,
  searchPlaceholder = "Search the market — egusi, gari, ata rodo…",
}: DesktopNavProps) {
  const [query, setQuery] = useState("");

  return (
    <nav className="dnav">
      <Comp className="dlogo" href={homeHref} aria-label="AfriMart — home">
        <Logo tone="on-light" size={25} />
      </Comp>

      <div className="dsearch">
        <SearchIcon />
        <input
          value={query}
          placeholder={searchPlaceholder}
          autoComplete="off"
          aria-label="Search the market"
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && query.trim()) onSearch?.(query.trim());
          }}
        />
      </div>

      <div className="dlinks">{children}</div>

      <Comp className="dcart" href={cartHref} aria-label="Cart">
        <CartIcon />
        {cartCount > 0 && <span className="dot">{cartCount}</span>}
      </Comp>
    </nav>
  );
}

export interface DesktopNavLinkProps extends AnchorHTMLAttributes<HTMLAnchorElement> {
  active?: boolean;
  as?: ElementType;
}

export function DesktopNavLink({ active, as: Comp = "a", children, ...props }: DesktopNavLinkProps) {
  return (
    <Comp className={active ? "on" : undefined} aria-current={active ? "page" : undefined} {...props}>
      {children}
    </Comp>
  );
}
