import { createTRPCReact, type CreateTRPCReact } from "@trpc/react-query";
import { httpBatchLink } from "@trpc/client";
import type { AppRouter } from "@afrimart/backend";

/**
 * The one typed client both apps/buyer and apps/merchant use to reach
 * services/backend. Buyer and merchant never call each other directly —
 * see CLAUDE.md "Repository structure".
 */
export const trpc: CreateTRPCReact<AppRouter, unknown> = createTRPCReact<AppRouter>();

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

export type { AppRouter };
