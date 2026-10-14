import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { inferRouterOutputs } from "@trpc/server";
import type { AppRouter } from "@afrimart/backend";

/** What each procedure returns, for typing a row, a prop or a helper. */
export type RouterOutputs = inferRouterOutputs<AppRouter>;

/**
 * The one typed client both apps/buyer and apps/merchant use to reach
 * services/backend. Buyer and merchant never call each other directly —
 * see CLAUDE.md "Repository structure".
 */
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

/**
 * Every request carries the signed-in session token as a bearer token, and
 * nothing else says who is asking: the server resolves the buyer or store from
 * that session, never from anything the page claims.
 */
export function createTrpcClientConfig(opts: { apiUrl: string; getAuthToken?: () => string | null }) {
  return {
    links: [
      httpBatchLink({
        url: opts.apiUrl,
        headers() {
          const token = opts.getAuthToken?.();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
      }),
    ],
  };
}

/**
 * Where a signed-in app keeps its session token in the browser.
 *
 * localStorage, because a buyer or a shop phone should still be signed in
 * tomorrow (the session itself is what bounds how long: idle and absolute
 * clocks, and revocable on the server). Every read and write is guarded, since
 * storage can be blocked or throw in a private window; without it the person
 * just signs in again. `subscribe` lets the tree react to a sign-in or sign-out
 * made anywhere, including another tab.
 */
export function createTokenStore(key: string) {
  const listeners = new Set<() => void>();
  const read = (): string | null => {
    try {
      return typeof window === "undefined" ? null : window.localStorage.getItem(key);
    } catch {
      return null;
    }
  };
  let memory: string | null = null; // keeps working for this tab when storage is blocked
  const get = () => read() ?? memory;
  const notify = () => listeners.forEach((l) => l());
  if (typeof window !== "undefined") window.addEventListener("storage", (e) => e.key === key && notify());
  return {
    get,
    set(token: string | null) {
      memory = token;
      try {
        if (token) window.localStorage.setItem(key, token);
        else window.localStorage.removeItem(key);
      } catch {
        /* blocked storage: the in-memory copy still signs this tab in */
      }
      notify();
    },
    subscribe(listener: () => void) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
  };
}

export type { AppRouter };
