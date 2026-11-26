self.addEventListener("push", event => {
  let alert = {};
  try { alert = event.data?.json() || {}; } catch { /* Show the inbox prompt for an empty notification. */ }
  event.waitUntil(self.registration.showNotification(typeof alert.title === "string" ? alert.title : "New order", {
    body: typeof alert.body === "string" ? alert.body : "Open Orders in AfriMart Merchant.",
    icon: "/icons/icon-192.png",
  }));
});

self.addEventListener("notificationclick", event => {
  event.notification.close();
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: "window", includeUncontrolled: true });
    const inbox = new URL("/", self.location.origin).href;
    for (const client of windows) {
      if (new URL(client.url).origin === self.location.origin) {
        const opened = await client.navigate(inbox);
        if (opened) { await opened.focus(); return; }
      }
    }
    await self.clients.openWindow(inbox);
  })());
});
