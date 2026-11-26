import { createECDH, ECDH } from "node:crypto";
import type { Prisma } from "@prisma/client";
import { generateRequestDetails } from "web-push";
import { z } from "zod";
import { prisma } from "../db.js";
import { USER_SESSION_IDLE_DAYS } from "../config.js";
import type { PushMessage } from "./senders.js";

function trustedPushEndpoint(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "https:" || url.username || url.password || url.port || url.hash) return false;
    return url.hostname === "fcm.googleapis.com" || url.hostname === "updates.push.services.mozilla.com" ||
      url.hostname.endsWith(".push.apple.com") || url.hostname.endsWith(".notify.windows.com");
  } catch { return false; }
}

const publicKey = z.string().regex(/^[A-Za-z0-9_-]{87}$/).refine(value => {
  try {
    const point = Buffer.from(value, "base64url");
    return point[0] === 4 && Buffer.from(ECDH.convertKey(point, "prime256v1")).equals(point);
  } catch { return false; }
});
export const deviceInput = z.object({
  endpoint: z.string().max(2000).refine(trustedPushEndpoint, "Unsupported browser push service."),
  p256dh: publicKey, auth: z.string().regex(/^[A-Za-z0-9_-]{22}$/), applicationKey: publicKey,
});

export function vapidConfig(env = process.env) {
  const { VAPID_PUBLIC_KEY: publicKey, VAPID_PRIVATE_KEY: privateKey, VAPID_SUBJECT: subject } = env;
  if (!publicKey || !privateKey || !subject) return null;
  try {
    if (!["mailto:", "https:"].includes(new URL(subject).protocol)) return null;
    const key = createECDH("prime256v1");
    key.setPrivateKey(Buffer.from(privateKey, "base64url"));
    if (key.getPublicKey().toString("base64url") !== publicKey) return null;
    return { publicKey, privateKey, subject };
  } catch { return null; }
}

export class BrowserPushSender {
  readonly name = "web-push";
  constructor(private readonly request: typeof fetch = fetch) {}

  async send(message: PushMessage, db: Prisma.TransactionClient = prisma) {
    const config = vapidConfig();
    if (!config) return false;
    const now = new Date();
    const devices = await db.merchantPushDevice.findMany({ where: { applicationKey: config.publicKey, session: {
      kind: "store", storeId: message.storeId, revokedAt: null, expiresAt: { gt: now },
      lastSeenAt: { gte: new Date(now.getTime() - USER_SESSION_IDLE_DAYS * 86400000) },
      store: { ownerPhoneVerifiedAt: { not: null } },
    } } });
    const payload = JSON.stringify({ title: message.title, body: message.body });
    const results = await Promise.allSettled(devices.map(async device => {
      if (!trustedPushEndpoint(device.endpoint)) return false;
      const req = generateRequestDetails({ endpoint: device.endpoint, keys: { p256dh: device.p256dh, auth: device.auth } },
        payload, { TTL: 300, urgency: "high", vapidDetails: config });
      const response = await this.request(req.endpoint, { method: "POST", headers: req.headers as Record<string, string>,
        body: new Uint8Array(req.body!), redirect: "error", signal: AbortSignal.timeout(6000) });
      await response.body?.cancel().catch(() => undefined);
      if (response.status === 404 || response.status === 410) {
        await db.merchantPushDevice.deleteMany({ where: { sessionId: device.sessionId, endpoint: device.endpoint, auth: device.auth } });
        return false;
      }
      if (!response.ok) throw Error("Push service refused the alert.");
      return true;
    }));
    if (results.some(r => r.status === "fulfilled" && r.value)) return true;
    if (results.some(r => r.status === "rejected")) throw Error("No push service accepted the alert.");
    return false;
  }
}
