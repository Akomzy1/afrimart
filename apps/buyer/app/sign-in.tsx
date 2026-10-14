"use client";

import { useState, useSyncExternalStore, type ReactNode } from "react";
import { trpc } from "@afrimart/api-client";
import { tokenStore } from "./providers";

/**
 * Sign in for buyers: an email address, then the six-digit code sent to it.
 *
 * No password to forget, and no separate "create an account": an address that
 * has never signed in becomes an account the first time its code is entered.
 * Browsing, search, the cook and the cart need none of this (CLAUDE.md: the
 * agent and the catalogue are never gated); it appears only where a page is
 * about the buyer's own orders, or at the moment they place one.
 *
 * There is no prototype screen for it, so it uses the design system's tokens
 * and the form patterns already in the checkout, and stays plain.
 */

/** True/false once the browser has been asked, undefined while it has not (the server render). */
export function useBuyerToken(): string | null | undefined {
  return useSyncExternalStore(tokenStore.subscribe, tokenStore.get, () => undefined);
}

export function SignInPanel({ heading = "Sign in to see your orders", lede }: { heading?: string; lede?: string }) {
  const [email, setEmail] = useState("");
  const [code, setCode] = useState("");
  const [step, setStep] = useState<"email" | "code">("email");
  const [notice, setNotice] = useState<string | null>(null);

  const request = trpc.userAuth.requestBuyerCode.useMutation({
    onSuccess: () => {
      setNotice(null);
      setStep("code");
    },
  });
  const verify = trpc.userAuth.verifyBuyerCode.useMutation({
    onSuccess: (r) => tokenStore.set(r.token),
    onError: () => setCode(""),
  });

  const emailOk = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email.trim());

  if (step === "email") {
    return (
      <form
        className="bsi"
        onSubmit={(e) => {
          e.preventDefault();
          if (emailOk && !request.isPending) request.mutate({ email });
        }}
      >
        <p className="eyebrow">Your account</p>
        <h1 className="serif">{heading}</h1>
        <p className="lede">{lede ?? "Enter your email address and we'll send you a code. There's no password to remember."}</p>
        <label htmlFor="bsi-email">Email address</label>
        <input
          id="bsi-email"
          type="email"
          inputMode="email"
          autoComplete="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        {request.isError && <div className="bsi-err" role="alert">{request.error.message}</div>}
        <button type="submit" className="bsi-go" disabled={!emailOk || request.isPending}>
          {request.isPending ? "Sending…" : "Send me a code"}
        </button>
      </form>
    );
  }

  const message = verify.error?.message ?? request.error?.message;
  return (
    <form
      className="bsi"
      onSubmit={(e) => {
        e.preventDefault();
        if (/^\d{6}$/.test(code) && !verify.isPending) verify.mutate({ email, code });
      }}
    >
      <p className="eyebrow">Check your email</p>
      <h1 className="serif">Enter your code</h1>
      <p className="lede">We sent a six-digit code to {email.trim()}. It works for ten minutes.</p>
      <label htmlFor="bsi-code">Six-digit code</label>
      <input
        id="bsi-code"
        className="bsi-code"
        inputMode="numeric"
        autoComplete="one-time-code"
        maxLength={6}
        value={code}
        onChange={(e) => setCode(e.target.value.replace(/\D/g, "").slice(0, 6))}
        autoFocus
      />
      {message && <div className="bsi-err" role="alert">{message}</div>}
      {notice && !message && <div className="bsi-note">{notice}</div>}
      <button type="submit" className="bsi-go" disabled={code.length !== 6 || verify.isPending}>
        {verify.isPending ? "Checking…" : "Sign in"}
      </button>
      <div className="bsi-alt">
        Didn&apos;t get it?{" "}
        <button type="button" onClick={() => request.mutate({ email }, { onSuccess: () => setNotice("We've sent a new code.") })} disabled={request.isPending}>
          Send a new code
        </button>
        {" · "}
        <button type="button" onClick={() => { setStep("email"); setCode(""); verify.reset(); }}>
          Use a different email
        </button>
      </div>
    </form>
  );
}

/** Shows its children to a signed-in buyer and the sign-in panel to everyone else. */
export function SignInGate({ children, heading, lede }: { children: ReactNode; heading?: string; lede?: string }) {
  const token = useBuyerToken();
  if (token === undefined) return null; // not yet known on the server render; avoids flashing the panel
  return token ? <>{children}</> : <SignInPanel heading={heading} lede={lede} />;
}
