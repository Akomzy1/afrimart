"use client";

import { useEffect, useState } from "react";
import { ShipCheckIcon, CheckIcon } from "@afrimart/ui";
import type { MerchantInstallEvent } from "../../instrumentation-client";

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
  const [deferred, setDeferred] = useState<MerchantInstallEvent | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    setIos(isIos());
    function refresh() {
      const offer = window.merchantInstall;
      setInstalled(offer === "installed" || isStandalone());
      setDeferred(offer && offer !== "installed" ? offer : null);
    }
    refresh();
    window.addEventListener("beforeinstallprompt", refresh);
    window.addEventListener("appinstalled", refresh);
    return () => {
      window.removeEventListener("beforeinstallprompt", refresh);
      window.removeEventListener("appinstalled", refresh);
    };
  }, []);

  if (installed) {
    return (
      <div className="mr-install done">
        <span className="ic">
          <CheckIcon strokeWidth={2.4} />
        </span>
        <span className="m">
          <span className="t">AfriMart is installed</span>
          <span className="s">Open your store from the AfriMart icon on your home screen.</span>
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
            Open your orders, camera and messages from one icon.
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
            if (window.merchantInstall !== deferred) return;
            delete window.merchantInstall;
            setDeferred(null);
            try {
              await deferred.prompt();
            } catch {
              // A stale browser offer falls back to the manual install steps.
            }
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
