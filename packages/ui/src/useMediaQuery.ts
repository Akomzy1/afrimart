"use client";

import { useCallback, useSyncExternalStore } from "react";

/**
 * Subscribes to a media query. Returns false during SSR and on the first client
 * render, so markup matches and hydration stays quiet; the real value lands in
 * the effect that follows.
 *
 * Use this only where a breakpoint changes *behaviour* (what renders, what state
 * means) — pure appearance belongs in a CSS media query.
 */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (onChange: () => void) => {
      if (typeof window === "undefined") return () => {};
      const mql = window.matchMedia(query);
      mql.addEventListener("change", onChange);
      return () => mql.removeEventListener("change", onChange);
    },
    [query],
  );

  return useSyncExternalStore(
    subscribe,
    () => window.matchMedia(query).matches,
    () => false,
  );
}

/** The desktop tier — where the mobile header and tab bar give way to DesktopNav. */
export const DESKTOP_QUERY = "(min-width: 1200px)";
