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
 * How a request says who it is.
 *
 * The buyer and merchant apps sign in with an httpOnly cookie the API sets, so
 * their pages never hold a session token: `credentials: "include"` is all they
 * do, and the browser attaches the cookie. The operations console signs in with
 * a bearer token it keeps for the length of a shift (`getAuthToken`), and sends
 * no cookie. Nothing in either case names a buyer or a store; the server works
 * that out from the session.
 */
export function createTrpcClientConfig(opts: {
  apiUrl: string;
  /** The operations console only. */
  getAuthToken?: () => string | null;
  /** The buyer and merchant apps: send the API's session cookie. */
  withCookies?: boolean;
}) {
  return {
    links: [
      httpBatchLink({
        url: opts.apiUrl,
        headers() {
          const token = opts.getAuthToken?.();
          return token ? { authorization: `Bearer ${token}` } : {};
        },
        fetch(url, init) {
          return fetch(url, { ...init, credentials: opts.withCookies ? "include" : "same-origin" });
        },
      }),
    ],
  };
}

export type { AppRouter };
