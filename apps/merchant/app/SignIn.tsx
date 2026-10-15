"use client";

import { useEffect, useRef, useState } from "react";
import { trpc } from "@afrimart/api-client";
import { LogoMark } from "@afrimart/ui";

/**
 * Sign in to the merchant app with the mobile number on file for the shop and a
 * code texted to it. AfriMart Merchant - Onboarding.html's phone and code
 * screens, which is where a seller meets the app for the first time.
 *
 * Two deliberate differences from that prototype. The code is six digits, not
 * four: four digits is ten thousand possibilities, which is too few to be the
 * only thing between a stranger and a shop's orders and payouts even with
 * attempt limits. And a number that has no shop is told exactly what a number
 * that does is told ("we've texted a code"), because the screen must not say who
 * is a seller; a code that never arrives is how they find out.
 *
 * There is no password and no "remember me": the session lasts for weeks on the
 * device and ends when the server says so.
 */

const DIGITS = 6;

export function SignIn() {
  const utils = trpc.useUtils();
  const [phone, setPhone] = useState("");
  const [step, setStep] = useState<"phone" | "code">("phone");
  const [code, setCode] = useState<string[]>(() => Array(DIGITS).fill(""));
  const [notice, setNotice] = useState<string | null>(null);
  const refs = useRef<(HTMLInputElement | null)[]>([]);

  const request = trpc.userAuth.requestStoreCode.useMutation({
    onSuccess: () => {
      setNotice(null);
      setStep("code");
    },
  });
  const verify = trpc.userAuth.verifyStoreCode.useMutation({
    // The cookie is already set by the response; refreshing `me` is what moves the app on.
    onSuccess: () => utils.invalidate(),
    onError: () => {
      setCode(Array(DIGITS).fill(""));
      refs.current[0]?.focus();
    },
  });

  useEffect(() => {
    if (step === "code") refs.current[0]?.focus();
  }, [step]);

  const digits = phone.replace(/\D/g, "");
  const canSend = digits.length >= 10 && !request.isPending;

  function submit(value: string[]) {
    if (value.every((d) => d) && !verify.isPending) verify.mutate({ phone, code: value.join("") });
  }

  function enter(index: number, raw: string) {
    // Typing replaces the box; pasting (or an autofilled code) spreads across them.
    const entered = raw.replace(/\D/g, "");
    if (!entered) {
      const next = [...code];
      next[index] = "";
      setCode(next);
      return;
    }
    const next = [...code];
    entered
      .slice(0, DIGITS - index)
      .split("")
      .forEach((d, i) => (next[index + i] = d));
    setCode(next);
    refs.current[Math.min(index + entered.length, DIGITS - 1)]?.focus();
    submit(next);
  }

  function back(index: number, key: string) {
    if (key === "Backspace" && !code[index] && index > 0) refs.current[index - 1]?.focus();
  }

  function resend() {
    request.mutate({ phone }, { onSuccess: () => setNotice("We've sent a new code.") });
  }

  // Asking for a code can fail (paced, or no way to send one); so can trying one.
  const message = step === "phone" ? request.error?.message : (verify.error?.message ?? request.error?.message);

  if (step === "phone") {
    return (
      <div className="mr-shell mr-onb">
        <div className="mr-onb-dark">
          <div className="wm">
            <LogoMark tone="on-dark" size={30} />
            <span>
              Afri<span className="m">Mart</span>
            </span>
          </div>
          <div className="mr-onb-hero">
            <p className="eyebrow">Seller sign in</p>
            <h1 className="serif">Welcome back to your shop.</h1>
            <div className="sub">Use the phone number we have for your shop.</div>
          </div>
          <div className="mr-onb-form">
            <label htmlFor="si-phone">Your phone number</label>
            <div className="mr-phone-in">
              <span className="flag">🇺🇸 +1</span>
              <input
                id="si-phone"
                inputMode="tel"
                autoComplete="tel"
                maxLength={16}
                placeholder="(555) 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && canSend && request.mutate({ phone })}
              />
            </div>
            <div className="mr-onb-note">We&apos;ll text you a code. No passwords to remember.</div>
            {message && <div className="mr-signin-err" role="alert">{message}</div>}
          </div>
        </div>
        <div className="mr-actionbar">
          <button
            type="button"
            className={`mr-bigbtn ${canSend ? "accent" : "disabled"}`}
            disabled={!canSend}
            onClick={() => request.mutate({ phone })}
          >
            {request.isPending ? "Sending…" : "Send my code"}
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-shell mr-onb">
      <div className="mr-scroll">
        <div className="mr-onb-content">
          <div className="mr-onb-head">
            <h1 className="serif">Enter your code</h1>
            <p>We texted a {DIGITS}-digit code to {phone}.</p>
          </div>
          <div className="mr-otp six">
            {code.map((d, i) => (
              <input
                key={i}
                ref={(el) => {
                  refs.current[i] = el;
                }}
                inputMode="numeric"
                autoComplete={i === 0 ? "one-time-code" : "off"}
                className={d ? "filled" : ""}
                value={d}
                aria-label={`Digit ${i + 1}`}
                onChange={(e) => enter(i, e.target.value)}
                onKeyDown={(e) => back(i, e.key)}
                onFocus={(e) => e.target.select()}
              />
            ))}
          </div>
          {message && <div className="mr-signin-err" role="alert">{message}</div>}
          {notice && !message && <div className="mr-onb-resend">{notice}</div>}
          <div className="mr-onb-resend">
            Didn&apos;t get it?{" "}
            <button type="button" className="mr-linkbtn" onClick={resend} disabled={request.isPending}>
              Resend code
            </button>
            {" · "}
            <button type="button" className="mr-linkbtn" onClick={() => { setStep("phone"); setCode(Array(DIGITS).fill("")); verify.reset(); }}>
              Change number
            </button>
          </div>
        </div>
      </div>
      <div className="mr-actionbar">
        <div className="mr-barhint">{verify.isPending ? "Checking…" : "Enter the code to continue"}</div>
      </div>
    </div>
  );
}
