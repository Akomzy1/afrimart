"use client";

import { useEffect, useState } from "react";
import { trpc } from "@afrimart/api-client";

const supported = () => typeof window !== "undefined" && window.isSecureContext &&
  "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
const encode = (bytes: ArrayBuffer) => btoa(String.fromCharCode(...new Uint8Array(bytes))).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");

async function waitForPush<T>(operation: Promise<T>): Promise<T> {
  let timer: number | undefined;
  try {
    return await Promise.race([operation, new Promise<never>((_, reject) => {
      timer = window.setTimeout(() => reject(new DOMException("Push service timed out", "TimeoutError")), 30000);
    })]);
  } finally { window.clearTimeout(timer); }
}

export function OrderAlertButton() {
  const settings = trpc.merchant.pushSettings.useQuery();
  const register = trpc.merchant.registerPush.useMutation();
  const disable = trpc.merchant.disablePush.useMutation();
  const [enabled, setEnabled] = useState(false);
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState("");
  const [ready, setReady] = useState(false);
  const key = settings.data?.publicKey;
  const deviceHash = settings.data?.deviceHash;

  useEffect(() => {
    let active = true;
    setReady(false);
    if (!key || !supported()) return;
    async function inspect() {
      const worker = await navigator.serviceWorker.getRegistration();
      const subscription = await worker?.pushManager.getSubscription();
      let matches = false;
      if (subscription && deviceHash && Notification.permission === "granted") {
        const hash = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(subscription.endpoint));
        matches = Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, "0")).join("") === deviceHash;
      }
      if (active) setEnabled(matches);
    }
    inspect().catch(() => { if (active) setEnabled(false); }).finally(() => { if (active) setReady(true); });
    return () => { active = false; };
  }, [key, deviceHash]);

  async function toggle() {
    if (!key || busy) return;
    setBusy(true);
    setNotice("");
    try {
      if (enabled) {
        await disable.mutateAsync();
        setEnabled(false);
        const worker = await navigator.serviceWorker.getRegistration();
        const sub = await worker?.pushManager.getSubscription();
        await sub?.unsubscribe();
      } else {
        const permission = await Notification.requestPermission();
        if (permission !== "granted") {
          setNotice(permission === "denied" ? "Allow notifications in your browser settings to receive order alerts." : "Order alerts are off on this device.");
          return;
        }
        await navigator.serviceWorker.register("/merchant-push.js");
        const worker = await waitForPush(navigator.serviceWorker.ready);
        let sub = await worker.pushManager.getSubscription();
        const currentKey = sub?.options.applicationServerKey;
        if (sub && (!currentKey || encode(currentKey) !== key)) { await sub.unsubscribe(); sub = null; }
        const subscribe = () => waitForPush(worker.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: key }));
        async function save(device: PushSubscription) {
          const { keys } = device.toJSON();
          if (!keys?.p256dh || !keys.auth) throw Error("Missing push credentials.");
          await register.mutateAsync({ endpoint: device.endpoint, p256dh: keys.p256dh, auth: keys.auth, applicationKey: key! });
        }
        const device = sub ?? await subscribe();
        try { await save(device); }
        catch (error) {
          if ((error as {data?: {code?: string}}).data?.code !== "CONFLICT") throw error;
          await device.unsubscribe();
          await save(await subscribe());
        }
        setEnabled(true);
      }
    } catch (error) {
      setNotice(error instanceof DOMException && error.name === "TimeoutError"
        ? "The push service is taking too long. Try again or check Orders directly."
        : "Couldn’t finish updating order alerts. Check your connection and try again.");
    } finally {
      void settings.refetch();
      setBusy(false);
    }
  }
  if (!key) return null;
  if (!supported()) return <p className="mr-alert-note">Open the installed merchant app in a browser that supports order alerts.</p>;
  return <div className="mr-alert-note">
    <button type="button" className="mr-secondary" disabled={!ready || busy} aria-pressed={enabled} onClick={toggle}>
      {busy ? "Updating alerts…" : enabled ? "Turn off order alerts on this device" : "Enable order alerts on this device"}
    </button>
    {notice && <p role="status">{notice}</p>}
  </div>;
}
