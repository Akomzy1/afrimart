"use client";

import { useEffect, useState } from "react";
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClientConfig } from "@afrimart/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc";

const isUnauthorised = (e: unknown) =>
  typeof e === "object" && e !== null && (e as { data?: { code?: string } }).data?.code === "UNAUTHORIZED";

/** The cached "who am I" answer, whatever the key shape the client gives it. */
const isSessionQuery = (key: readonly unknown[]) => JSON.stringify(key).includes("buyerMe");

export function Providers({ children }: { children: React.ReactNode }) {
  // The session is an httpOnly cookie the browser sends on its own; this page
  // never holds it. So "signed in" is whatever the server says to buyerMe, and
  // a session that has expired or been revoked shows up as UNAUTHORIZED on the
  // next thing the app asks. That refreshes buyerMe, which then reads
  // UNAUTHORIZED itself and the sign-in panel appears where a page needed one.
  // A wrong sign-in code is also UNAUTHORIZED, by design, and is not that.
  const [queryClient] = useState(() => {
    const client: QueryClient = new QueryClient({
      queryCache: new QueryCache({
        onError: (e, query) => {
          if (isUnauthorised(e) && !isSessionQuery(query.queryKey)) client.invalidateQueries({ predicate: (q) => isSessionQuery(q.queryKey) });
        },
      }),
      mutationCache: new MutationCache({
        onError: (e, _v, _c, mutation) => {
          if (isUnauthorised(e) && !JSON.stringify(mutation.options.mutationKey ?? "").includes("userAuth")) {
            client.invalidateQueries({ predicate: (q) => isSessionQuery(q.queryKey) });
          }
        },
      }),
    });
    return client;
  });
  const [trpcClient] = useState(() => trpc.createClient(createTrpcClientConfig({ apiUrl: API_URL, withCookies: true })));

  // Sessions used to be kept in the page's storage, where a script could read
  // them. Anyone who still has one there has it removed; it no longer works anyway.
  useEffect(() => {
    try {
      window.localStorage.removeItem("afrimart.buyer.token");
    } catch {
      /* blocked storage: nothing to remove */
    }
  }, []);

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
