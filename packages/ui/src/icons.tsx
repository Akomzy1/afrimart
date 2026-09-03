import type { SVGProps } from "react";

/** Inline icons matching the exact paths used across the prototype pages. */

export function SearchIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" strokeLinecap="round" />
    </svg>
  );
}

export function StarIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 3l2.6 5.6 6 .7-4.5 4.1 1.2 6L12 16.9 6.7 19.5l1.2-6L3.4 9.3l6-.7z" />
    </svg>
  );
}

export function CheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function PlusIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" />
    </svg>
  );
}

export function HeartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" {...props}>
      <path d="M12 21c5-3 8-6.5 8-11a5 5 0 0 0-9-3 5 5 0 0 0-9 3c0 4.5 3 8 8 11z" />
    </svg>
  );
}

export function SealIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.5} {...props}>
      <path d="M12 2l2.4 1.8 3-.1 1 2.8 2.4 1.8-.9 2.9.9 2.9-2.4 1.8-1 2.8-3-.1L12 22l-2.4-1.8-3 .1-1-2.8L3.2 15.8l.9-2.9-.9-2.9 2.4-1.8 1-2.8 3 .1z" />
      <path d="M8.6 12.2l2.2 2.2 4.4-4.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ChevronLeftIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M15 6l-6 6 6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ArrowRightIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M5 12h14M13 6l6 6-6 6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function CloseIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} {...props}>
      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
    </svg>
  );
}

export function FiltersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.7} {...props}>
      <path d="M4 6h16M7 12h10M10 18h4" strokeLinecap="round" />
    </svg>
  );
}

export function CartIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path
        d="M4 5h2l1.6 10.2a1.5 1.5 0 0 0 1.5 1.3h8a1.5 1.5 0 0 0 1.5-1.2L20.5 8H7"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <circle cx="10" cy="20" r="1.2" fill="currentColor" />
      <circle cx="18" cy="20" r="1.2" fill="currentColor" />
    </svg>
  );
}

export function LocationIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M12 21c5-5 8-8.4 8-12a8 8 0 1 0-16 0c0 3.6 3 7 8 12z" />
      <circle cx="12" cy="9" r="2.6" />
    </svg>
  );
}

export function MicIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <rect x="9" y="3" width="6" height="12" rx="3" />
      <path d="M6 11a6 6 0 0 0 12 0M12 17v4" strokeLinecap="round" />
    </svg>
  );
}

export function SparkleIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" stroke="none" {...props}>
      <path d="M12 3l1.6 3.4L17 8l-3.4 1.6L12 13l-1.6-3.4L7 8l3.4-1.6z" />
      <path d="M6 15l.9 1.9L9 18l-2.1.9L6 21l-.9-2.1L3 18l2.1-1.1z" />
    </svg>
  );
}

export function CookPotIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.6} {...props}>
      <path d="M7 21h10M6 11a6 6 0 0 1 12 0v6H6v-6z" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M15 5l.7 1.6L17.3 7l-1.6.7L15 9.3 14.3 7.7 12.7 7l1.6-.4z" fill="currentColor" stroke="none" />
    </svg>
  );
}

export function HomeIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M4 11l8-7 8 7M6 10v9h4v-6h4v6h4v-9" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export function ShopBagIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path
        d="M4 8h16l-1 11a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1L4 8zM8 8V6a4 4 0 0 1 8 0v2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

export function OrdersIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <path d="M6 3h12l1 4v13a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7l1-4z" strokeLinejoin="round" />
      <path d="M9 11h6M9 15h4" strokeLinecap="round" />
    </svg>
  );
}

export function AccountIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" {...props}>
      <circle cx="12" cy="8.5" r="3.5" />
      <path d="M5 20c1.4-4 4-6 7-6s5.6 2 7 6" strokeLinecap="round" />
    </svg>
  );
}

export function ShipCheckIcon(props: SVGProps<SVGSVGElement>) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} {...props}>
      <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

/** Product placeholder art — no real photography yet, so listings render one of
 * these glyphs on a warm radial-gradient shot, matching every prototype page. */
export type ProductGlyphKind = "leaf" | "wheat" | "pepper" | "jar" | "seed";

export function ProductGlyph({ kind, ...props }: { kind: ProductGlyphKind } & SVGProps<SVGSVGElement>) {
  const paths: Record<ProductGlyphKind, string> = {
    leaf: "M11 21c-5-1-8-5-8-11 6 0 10 4 10 11M13 21c5-1 8-5 8-11-6 0-10 4-10 11M12 22V10",
    wheat:
      "M12 22V9M12 9c0-2 1.5-3.5 3.5-3.5 0 2-1.5 3.5-3.5 3.5zM12 9c0-2-1.5-3.5-3.5-3.5 0 2 1.5 3.5 3.5 3.5zM12 14c0-2 1.5-3.5 3.5-3.5 0 2-1.5 3.5-3.5 3.5zM12 14c0-2-1.5-3.5-3.5-3.5 0 2 1.5 3.5 3.5 3.5z",
    pepper: "M8 8c0-3 3-4 5-3M8 8c-2 3-1 8 3 10 5 2 8-3 6-7-1.5-3-6-4-9-3z",
    jar: "M8 3h8M7 7h10v12a2 2 0 0 1-2 2H9a2 2 0 0 1-2-2V7zM7 7c0-2 1.5-3 2.5-3M17 7c0-2-1.5-3-2.5-3",
    seed: "M12 3c4 2 6 5 6 9a6 6 0 0 1-12 0c0-4 2-7 6-9zM12 8v8M9 11h6",
  };
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.3} strokeLinecap="round" strokeLinejoin="round" {...props}>
      <path d={paths[kind]} />
    </svg>
  );
}
