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
 * Development-only identity, sent as `x-dev-identity: buyer:<id>` or `store:<id>`.
 * The backend's identity stub reads it and refuses to run anywhere that looks
 * like production; real buyer and merchant sign-in replaces both ends of this.
 */
export const DEV_IDENTITY_HEADER = "x-dev-identity";

export function createTrpcClientConfig(opts: {
  apiUrl: string;
  getAuthToken?: () => string | null;
  getDevIdentity?: () => string | null;
}) {
  return {
    links: [
      httpBatchLink({
        url: opts.apiUrl,
        headers() {
          const token = opts.getAuthToken?.();
          const identity = opts.getDevIdentity?.();
          return {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(identity ? { [DEV_IDENTITY_HEADER]: identity } : {}),
          };
        },
      }),
    ],
  };
}

export type { AppRouter };
