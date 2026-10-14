"use client";

import { useState } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClientConfig, createTokenStore } from "@afrimart/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc";

/** The signed-in shop's session. Present means "probably signed in"; the server is the judge. */
export const tokenStore = createTokenStore("afrimart.merchant.token");

/** A photo link from the API (`/photos/...?exp=&sig=`) as a full URL the browser can load. */
export function photoUrl(path: string): string {
  return new URL(path, API_URL).toString();
}

const isUnauthorised = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { data?: { code?: string } }).data?.code === "UNAUTHORIZED";

export function Providers({ children }: { children: React.ReactNode }) {
  // A session that has expired, been revoked or was never good shows up as
  // UNAUTHORIZED on whatever the app asks next; that clears the token, which
  // returns the person to the sign-in screen rather than leaving a broken app.
  const [queryClient] = useState(
    () =>
      new QueryClient({
        queryCache: new QueryCache({ onError: (e) => isUnauthorised(e) && tokenStore.set(null) }),
        mutationCache: new MutationCache({ onError: (e, _v, _c, mutation) => {
          // A wrong sign-in code is UNAUTHORIZED by design and must not read as an expired session.
          if (isUnauthorised(e) && !JSON.stringify(mutation.options.mutationKey ?? "").includes("userAuth")) tokenStore.set(null);
        } }),
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
