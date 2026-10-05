"use client";

import { useState } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { trpc, createTrpcClientConfig } from "@afrimart/api-client";

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:4000/trpc";

/**
 * Where the staff token lives in the browser.
 *
 * sessionStorage, not localStorage: a console tab closed at the end of a
 * shift should not leave a usable token behind on a shared machine. The
 * server-side idle timeout is the real control — this just avoids handing out
 * a token that outlives the window someone was working in.
 */
const TOKEN_KEY = "afrimart.ops.token";

export function readStaffToken(): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function writeStaffToken(token: string | null) {
  try {
    if (token) window.sessionStorage.setItem(TOKEN_KEY, token);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    // Private browsing or blocked storage: the console still works for this
    // page load, the operator just signs in again on reload.
  }
}

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(() => new QueryClient({ defaultOptions: { queries: { retry: false } } }));
  const [trpcClient] = useState(() =>
    trpc.createClient(createTrpcClientConfig({ apiUrl: API_URL, getAuthToken: readStaffToken })),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </trpc.Provider>
  );
}
