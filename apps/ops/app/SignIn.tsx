"use client";

import { useState } from "react";
import { trpc } from "@afrimart/api-client";
import { writeStaffToken } from "./providers";

/**
 * Staff sign-in: password, then a six-digit code.
 *
 * The two steps are not cosmetic. The password call returns a token that can
 * reach nothing — every ops route checks that the session has cleared its
 * second factor — so a stolen password on its own buys an attacker a useless
 * string.
 */
export function SignIn({ onSignedIn }: { onSignedIn: () => void }) {
  const [stage, setStage] = useState<"password" | "code" | "enrol">("password");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [code, setCode] = useState("");
  const [token, setToken] = useState<string | null>(null);
  const [enrolUri, setEnrolUri] = useState<string | null>(null);
  const [secret, setSecret] = useState<string | null>(null);

  const signIn = trpc.staffAuth.signIn.useMutation({
    onSuccess: (r) => {
      setToken(r.token);
      if (r.mfaEnrolled) {
        setStage("code");
      } else {
        beginEnrol.mutate({ token: r.token });
      }
    },
  });

  const beginEnrol = trpc.staffAuth.beginMfaEnrolment.useMutation({
    onSuccess: (r) => {
      setSecret(r.secret);
      setEnrolUri(r.otpauthUrl);
      setStage("enrol");
    },
  });

  const verify = trpc.staffAuth.verifyMfa.useMutation({
    onSuccess: () => {
      writeStaffToken(token);
      onSignedIn();
    },
  });

  const confirmEnrol = trpc.staffAuth.confirmMfaEnrolment.useMutation({
    onSuccess: () => {
      writeStaffToken(token);
      onSignedIn();
    },
  });

  const error = signIn.error ?? verify.error ?? confirmEnrol.error ?? beginEnrol.error;

  return (
    <div className="op-shell">
      <div className="op-top">
        <h1>AfriMart Operations</h1>
        <span className="env">Staff only</span>
      </div>

      <div className="op-signin">
        {stage === "password" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              signIn.mutate({ email, password });
            }}
          >
            <h2>Sign in</h2>
            <p className="lede">This console changes catalogue, seller standing and money. Access is logged.</p>
            <label htmlFor="em">Email</label>
            <input
              id="em"
              className="op-input"
              type="email"
              autoComplete="username"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
            />
            <label htmlFor="pw">Password</label>
            <input
              id="pw"
              className="op-input"
              type="password"
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
            />
            <button type="submit" className="op-btn primary" disabled={signIn.isPending}>
              {signIn.isPending ? "Checking…" : "Continue"}
            </button>
          </form>
        )}

        {stage === "code" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (token) verify.mutate({ token, code });
            }}
          >
            <h2>Authenticator code</h2>
            <p className="lede">Six digits from your authenticator app.</p>
            <label htmlFor="cd">Code</label>
            <input
              id="cd"
              className="op-input"
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <button type="submit" className="op-btn primary" disabled={verify.isPending}>
              {verify.isPending ? "Checking…" : "Sign in"}
            </button>
          </form>
        )}

        {stage === "enrol" && (
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (token) confirmEnrol.mutate({ token, code });
            }}
          >
            <h2>Set up your authenticator</h2>
            <p className="lede">
              Add this account to your authenticator app, then enter the code it shows. You won&apos;t be able to see
              this key again.
            </p>
            {secret && (
              <p className="op-secret">
                <code>{secret}</code>
              </p>
            )}
            {enrolUri && <p className="muted op-uri">{enrolUri}</p>}
            <label htmlFor="ec">Code</label>
            <input
              id="ec"
              className="op-input"
              inputMode="numeric"
              maxLength={8}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              required
            />
            <button type="submit" className="op-btn primary" disabled={confirmEnrol.isPending}>
              Confirm
            </button>
          </form>
        )}

        {error && (
          <p className="op-err" role="alert">
            {error.message}
          </p>
        )}
      </div>
    </div>
  );
}
