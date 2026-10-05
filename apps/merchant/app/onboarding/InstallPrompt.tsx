"use client";

import { useEffect, useState } from "react";
import { ShipCheckIcon, CheckIcon } from "@afrimart/ui";

/**
 * Prompts the seller to install the app to their home screen.
 *
 * This is not a nicety. Merchant new-order alerts are web push, and on iOS
 * web push is delivered *only* to a PWA the user has added to their home
 * screen — a seller who stays in Safari receives nothing, forever, with no
 * error anywhere. The screen this sits on promises "we'll send your first
 * order to your phone", so without this the promise is false for every
 * iPhone seller.
 *
 * Three states, because the platforms differ in what they allow:
 *   - already installed: say so and stop asking
 *   - Android/desktop Chrome: `beforeinstallprompt` gives a real button
 *   - iOS: no programmatic prompt exists, so show the manual steps
 */

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

function isStandalone(): boolean {
  if (typeof window === "undefined") return false;
  return (
    window.matchMedia?.("(display-mode: standalone)").matches ||
    // iOS Safari predates the standard and uses its own flag.
    (window.navigator as unknown as { standalone?: boolean }).standalone === true
  );
}

function isIos(): boolean {
  if (typeof navigator === "undefined") return false;
  return /iphone|ipad|ipod/i.test(navigator.userAgent);
}

export function InstallPrompt() {
  const [installed, setInstalled] = useState(false);
  const [ios, setIos] = useState(false);
  const [deferred, setDeferred] = useState<BeforeInstallPromptEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setInstalled(isStandalone());
    setIos(isIos());

    const onPrompt = (e: Event) => {
      // Chrome fires this instead of showing its own banner once we
      // preventDefault, which lets the button live in the flow rather than
      // appearing as browser chrome the seller ignores.
      e.preventDefault();
      setDeferred(e as BeforeInstallPromptEvent);
    };
    const onInstalled = () => setInstalled(true);

    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (installed) {
    return (
      <div className="mr-install done">
        <span className="ic">
          <CheckIcon strokeWidth={2.4} />
        </span>
        <span className="m">
          <span className="t">Alerts are on</span>
          <span className="s">AfriMart is on your home screen, so new orders will reach you.</span>
        </span>
      </div>
    );
  }

  if (dismissed) return null;

  return (
    <div className="mr-install">
      <div className="ih">
        <span className="ic">
          <ShipCheckIcon />
        </span>
        <div className="m">
          <div className="t">Put AfriMart on your home screen</div>
          <div className="s">
            New orders arrive as an alert on your phone. That only works once the app is on your home screen.
          </div>
        </div>
      </div>

      {ios ? (
        // iOS gives no programmatic install, so the steps have to be spelled
        // out. Naming the icon rather than just "Share" is deliberate: the
        // button has no label on iOS.
        <ol className="mr-installsteps">
          <li>
            Tap the <b>Share</b> button at the bottom of Safari — the square with an arrow pointing up.
          </li>
          <li>
            Scroll down and tap <b>Add to Home Screen</b>.
          </li>
          <li>
            Tap <b>Add</b>.
          </li>
        </ol>
      ) : deferred ? (
        <button
          type="button"
          className="mr-bigbtn green"
          onClick={async () => {
            await deferred.prompt();
            const { outcome } = await deferred.userChoice;
            if (outcome === "accepted") setInstalled(true);
            setDeferred(null);
          }}
        >
          Add to home screen
        </button>
      ) : (
        <p className="mr-installnote">
          Open your browser menu and choose <b>Install app</b> or <b>Add to Home screen</b>.
        </p>
      )}

      <button type="button" className="mr-installskip" onClick={() => setDismissed(true)}>
        I&apos;ll do this later
      </button>
    </div>
  );
}
