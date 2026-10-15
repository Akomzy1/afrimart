"use client";

import { useEffect, useState, type ReactNode } from "react";
import { trpc } from "@afrimart/api-client";
import { CameraIcon, CheckIcon, ChevronLeftIcon } from "@afrimart/ui";
import { DOCUMENT_PHOTO, PhotoCamera } from "./PhotoCamera";

/**
 * The AfriMart thread in Messages — AfriMart Merchant.html. Where a seller asks
 * for licensed-kitchen status or an authenticity badge: pick one, then send a
 * photo of the document.
 *
 * What the prototype simulates and this does not: it answers "Approved" a few
 * seconds after the photo. Here the photo becomes an application that waits for
 * a person (QC-1, CAT-8), so the thread says it is being checked and stays that
 * way until operations decides. Approval, when it comes, is read from the
 * server, so the thread tells the same story on every visit and never claims a
 * status the seller does not have.
 */

type Kind = "kitchen" | "diaspora_owned" | "imported_direct" | "made_in_usa_african_brand";

const OPTIONS: Record<Kind, { label: string; ask: string; doc: string; ok: string; icon: ReactNode }> = {
  kitchen: {
    label: "Licensed kitchen",
    ask: "your kitchen licence",
    doc: "Kitchen licence",
    ok: "Licensed kitchen status is on. You can now list chilled and frozen food.",
    icon: (
      <path d="M4 11h16v7a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2v-7zM2 11h20M8 7c0-2 2-2 2-4M14 7c0-2 2-2 2-4" />
    ),
  },
  diaspora_owned: {
    label: "Diaspora-owned",
    ask: "your business registration",
    doc: "Business registration",
    ok: "The diaspora-owned badge is now on your shop.",
    icon: <path d="M3 11l9-7 9 7M5 10v10h14V10" />,
  },
  imported_direct: {
    label: "Imported direct",
    ask: "your import invoice",
    doc: "Import invoice",
    ok: "The imported direct badge is now on your shop.",
    icon: <path d="M3 8l9-5 9 5v8l-9 5-9-5V8zM3 8l9 5 9-5M12 13v8" />,
  },
  made_in_usa_african_brand: {
    label: "Made in USA by an African brand",
    ask: "your brand registration",
    doc: "Brand registration",
    ok: "The made in USA by an African brand badge is now on your shop.",
    icon: <path d="M12 3l2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3z" />,
  },
};

function Ic({ children, size = 1.7 }: { children: ReactNode; size?: number }) {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={size} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {children}
    </svg>
  );
}

export function SupportThread({ onBack }: { onBack: () => void }) {
  const utils = trpc.useUtils();
  const standing = trpc.merchant.standing.useQuery();
  const thread = trpc.merchant.thread.useQuery();
  // Opening the thread is what reads it.
  const markRead = trpc.merchant.markThreadRead.useMutation({ onSuccess: () => utils.merchant.thread.invalidate() });
  const unreadCount = thread.data?.unread ?? 0;
  useEffect(() => {
    if (unreadCount > 0 && !markRead.isPending) markRead.mutate();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCount]);
  const payouts = (thread.data?.messages ?? []).filter((m) => m.kind === "payout");
  // Notices from AfriMart that are just words (a licence that has lapsed).
  const notices = (thread.data?.messages ?? []).filter((m) => m.kind === "licence_expired");
  const dashboard = trpc.merchant.payoutDashboardLink.useMutation();

  /**
   * "See all payouts" opens the seller's Stripe Express dashboard. The link is
   * made on request and is single-use, so a window is opened first (a popup
   * opened after a network call is blocked) and pointed at it when it arrives.
   */
  function seeAllPayouts() {
    const win = window.open("about:blank", "_blank");
    dashboard.mutate(undefined, {
      onSuccess: ({ url }) => {
        if (win) {
          win.opener = null;
          win.location.href = url;
        } else window.location.href = url;
      },
      onError: () => win?.close(),
    });
  }
  // The menu in this thread's header: sign out of this phone, or of every phone.
  // The server ends the session and clears the cookie; reloading then drops
  // whatever this page held about the shop and shows the sign-in screen.
  const [menuOpen, setMenuOpen] = useState(false);
  const [confirmAll, setConfirmAll] = useState(false);
  const signOut = trpc.userAuth.signOutStore.useMutation({ onSuccess: () => window.location.reload() });
  const signOutAll = trpc.userAuth.signOutStoreEverywhere.useMutation({ onSuccess: () => window.location.reload() });
  const [picked, setPicked] = useState<Kind | null>(null);
  const [camera, setCamera] = useState(false);
  const applyKitchen = trpc.merchant.applyForKitchenLicence.useMutation();
  const applyBadge = trpc.merchant.applyForBadge.useMutation();
  const sending = applyKitchen.isPending || applyBadge.isPending;
  const error = (applyKitchen.error ?? applyBadge.error)?.message ?? null;

  const s = standing.data;
  // status of each thing a seller can ask for; null means never applied
  const status = (k: Kind): string | null =>
    !s ? null : k === "kitchen" ? s.kitchen : (s.badges.find((b) => b.kind === k)?.status ?? null);

  const kinds = (Object.keys(OPTIONS) as Kind[]).filter((k) => k !== "kitchen" || s?.homeTier);
  const open = s ? kinds.filter((k) => status(k) !== "applied" && status(k) !== "approved") : [];
  const waiting = kinds.filter((k) => status(k) === "applied");
  const approved = kinds.filter((k) => status(k) === "approved");

  function send(document: string) {
    if (!picked) return;
    const done = {
      onSuccess: async () => {
        await utils.merchant.standing.invalidate();
        setCamera(false);
        setPicked(null);
      },
    };
    // A refusal to take documents (storage not ready) lands in `error` and is shown as written.
    if (picked === "kitchen") applyKitchen.mutate({ document }, done);
    else applyBadge.mutate({ kind: picked, document }, done);
  }

  return (
    <div className="mr-shell">
      <div className="mr-header">
        <button type="button" className="back" onClick={onBack} aria-label="Back to Messages">
          <ChevronLeftIcon />
        </button>
        <h2 className="serif">AfriMart</h2>
        <div className="mr-menuwrap">
          <button
            type="button"
            className="mr-menubtn"
            aria-label="Menu"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            onClick={() => {
              setMenuOpen((o) => !o);
              setConfirmAll(false);
            }}
          >
            <svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
              <circle cx="5" cy="12" r="2" />
              <circle cx="12" cy="12" r="2" />
              <circle cx="19" cy="12" r="2" />
            </svg>
          </button>
          {menuOpen && (
            <>
              <button type="button" className="mr-menuscrim" aria-label="Close menu" onClick={() => setMenuOpen(false)} />
              <div className="mr-menu" role="menu">
                {!confirmAll ? (
                  <>
                    <button type="button" role="menuitem" disabled={signOut.isPending} onClick={() => signOut.mutate()}>
                      Sign out
                    </button>
                    <button type="button" role="menuitem" disabled={signOut.isPending} onClick={() => setConfirmAll(true)}>
                      Sign out of all devices
                    </button>
                  </>
                ) : (
                  <div className="mr-menuconfirm">
                    <p>Sign out everywhere? Every phone using this shop will need a new code to get back in.</p>
                    <button type="button" className="danger" disabled={signOutAll.isPending} onClick={() => signOutAll.mutate()}>
                      {signOutAll.isPending ? "Signing out…" : "Yes, sign out everywhere"}
                    </button>
                    <button type="button" onClick={() => setConfirmAll(false)}>
                      Cancel
                    </button>
                  </div>
                )}
                {(signOut.isError || signOutAll.isError) && <p className="err">We couldn&apos;t sign you out. Check your connection and try again.</p>}
              </div>
            </>
          )}
        </div>
      </div>

      <div className="mr-scroll">
        <div className="mr-thread">
          {/* Which words, and which options, depend on the shop's standing; show neither until it has loaded. */}
          {s && (
            <div className="b-in support">
              {s.homeTier
                ? "Want to sell chilled food or show a badge? Tap one below, then send us a photo of your document."
                : "Want to show a badge on your shop? Tap one below, then send us a photo of your document."}
            </div>
          )}

          {notices.map((n) => (
            <div className="b-in support" key={n.id}>
              {n.body}
            </div>
          ))}

          {payouts.map((p) => (
            <div className="b-in support payout" key={p.id}>
              <div className="k">Payout sent</div>
              <div className="amt serif tnum">{p.amountCents === null ? "" : `$${(p.amountCents / 100).toFixed(2)}`}</div>
              <div className="d">
                {p.paidOn ? new Date(p.paidOn).toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" }) : ""}
              </div>
              <div className="d">Covers order{p.orderRefs.length > 1 ? "s" : ""} {p.orderRefs.join(", ")}</div>
            </div>
          ))}
          {payouts.length > 0 && (
            <div className="mr-qrs">
              {dashboard.isError && <div className="mr-sheet-err">{dashboard.error.message}</div>}
              <button type="button" className="mr-bigbtn ghost" onClick={seeAllPayouts} disabled={dashboard.isPending}>
                {dashboard.isPending ? "Opening…" : "See all payouts"}
              </button>
            </div>
          )}

          {approved.map((k) => (
            <div className="b-in support approved" key={`ok-${k}`}>
              <span className="ap">
                <CheckIcon strokeWidth={2.4} />
              </span>
              <div>
                <div className="at serif">Approved</div>
                <div className="as">{OPTIONS[k].ok}</div>
              </div>
            </div>
          ))}

          {waiting.map((k) => (
            <div className="mr-thread-group" key={`wait-${k}`}>
              <div className="b-out">
                I want to apply for {k === "kitchen" ? "licensed kitchen status" : `the ${OPTIONS[k].label.toLowerCase()} badge`}.
              </div>
              <div className="b-in support">Got it. We&apos;re checking it now. We&apos;ll message you here as soon as it&apos;s done.</div>
            </div>
          ))}

          {picked && (
            <>
              <div className="b-out">
                I want to apply for {picked === "kitchen" ? "licensed kitchen status" : `the ${OPTIONS[picked].label.toLowerCase()} badge`}.
              </div>
              <div className="b-in support">Please send a photo of {OPTIONS[picked].ask}.</div>
              <div className="mr-qrs">
                {error && <div className="mr-sheet-err">{error}</div>}
                <button type="button" className="mr-bigbtn accent" onClick={() => setCamera(true)}>
                  <CameraIcon />
                  Send photo of document
                </button>
                <button type="button" className="mr-bigbtn ghost" onClick={() => setPicked(null)}>
                  Choose something else
                </button>
              </div>
            </>
          )}

          {!picked && open.length > 0 && (
            <div className="mr-qrs">
              <div className="eyebrow q">Apply for</div>
              {open.map((k) => (
                <button type="button" key={k} className="mr-qr" onClick={() => {
                    applyKitchen.reset();
                    applyBadge.reset();
                    setPicked(k);
                  }}>
                  <span className="ic">
                    <Ic>{OPTIONS[k].icon}</Ic>
                  </span>
                  {OPTIONS[k].label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {camera && picked && (
        <PhotoCamera
          copy={DOCUMENT_PHOTO(OPTIONS[picked].doc)}
          saving={sending}
          error={error}
          onClose={() => setCamera(false)}
          onUse={send}
        />
      )}
    </div>
  );
}
