"use client";

import { useState } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClientConfig, createTokenStore } from "@afrimart/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc";

/** The signed-in buyer's session. Present means "probably signed in"; the server is the judge. */
export const tokenStore = createTokenStore("afrimart.buyer.token");

const isUnauthorised = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { data?: { code?: string } }).data?.code === "UNAUTHORIZED";

export function Providers({ children }: { children: React.ReactNode }) {
  // A session that has expired or been revoked comes back UNAUTHORIZED on the
  // next thing the app asks; that clears the token and the sign-in panel
  // appears where the page needed one. A wrong sign-in code is also
  // UNAUTHORIZED, by design, and is not an expired session.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (e) => isUnauthorised(e) && tokenStore.set(null) }),
        mutationCache: new MutationCache({
          onError: (e, _v, _c, mutation) => {
            if (isUnauthorised(e) && !JSON.stringify(mutation.options.mutationKey ?? "").includes("userAuth")) tokenStore.set(null);
          },
        }),
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient(createTrpcClientConfig({ apiUrl: API_URL, getAuthToken: () => tokenStore.get() })),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
