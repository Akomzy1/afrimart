// Chrome can offer installation while the seller is still signing in.
// The event is single-use and belongs to this browser document.
export interface MerchantInstallEvent extends Event {
  prompt(): Promise<void>;
}

declare global {
  interface Window {
    merchantInstall?: MerchantInstallEvent | "installed";
  }
}

window.addEventListener("beforeinstallprompt", event => {
  if (window.location.pathname === "/onboarding") event.preventDefault();
  window.merchantInstall = event as MerchantInstallEvent;
});
window.addEventListener("appinstalled", () => {
  window.merchantInstall = "installed";
});
