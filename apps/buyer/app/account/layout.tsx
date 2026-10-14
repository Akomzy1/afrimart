import type { ReactNode } from "react";
import { SignInGate } from "../sign-in";

/**
 * Everything under /account is about the buyer's own orders, so it is behind
 * sign-in. The server also refuses these calls without a session; this is what
 * makes the page ask rather than show an error.
 */
export default function AccountLayout({ children }: { children: ReactNode }) {
  return <SignInGate>{children}</SignInGate>;
}
