"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClientConfig } from "@afrimart/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc";

/**
 * Development stand-in for "which store is signed in". The page sets it once it
 * knows the store (from ?store= or the first live one) and every request then
 * carries it as an identity header, never as input. Goes when real merchant
 * sign-in lands.
 */
let devStoreId: string | null = null;

/** A photo path from the API (`/photos/...`) as a full URL the browser can load. */
export function photoUrl(path: string): string {
  return new URL(path, API_URL).toString();
}
export function setDevStoreId(id: string | null) {
  devStoreId = id;
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient());
  const [trpcClient] = useState(() => trpc.createClient(createTrpcClientConfig({ apiUrl: API_URL, getDevIdentity: () => (devStoreId ? `store:${devStoreId}` : null) })));

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
