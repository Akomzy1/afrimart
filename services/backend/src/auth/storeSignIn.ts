import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { issueUserSession } from "./userSession.js";

const wrong = () => new TRPCError({ code: "UNAUTHORIZED", message: "That code didn't work. Check it and try again, or ask for a new one." });

/** Called only after spending a code. Verification and session creation commit
 * together, serialized against staff changing the phone on the same store. */
export async function signInVerifiedStore(
  phone: string,
  proof: { storeIdAtIssue: string | null; storePhoneVersion: number | null },
  allowCreate: boolean,
  meta: { ip?: string; userAgent?: string },
) {
  return prisma.$transaction(async (tx) => {
    let store = await tx.store.findUnique({ where: { ownerPhone: phone } });
    if (store) {
      if (store.id !== proof.storeIdAtIssue || store.ownerPhoneVersion !== proof.storePhoneVersion) throw wrong();
      const updated = await tx.store.updateMany({
        where: { id: store.id, ownerPhone: phone, ownerPhoneVersion: proof.storePhoneVersion },
        data: { ownerPhoneVerifiedAt: store.ownerPhoneVerifiedAt ?? new Date() },
      });
      if (updated.count !== 1) throw wrong();
    } else {
      if (!allowCreate || proof.storeIdAtIssue) throw wrong();
      // Provisional assignment only: staff can reassign before approving. No hub
      // is invented and no seller can trade simply by registering a number.
      const hub = await tx.hubMetro.findFirst({ where: { active: true }, orderBy: { name: "asc" } });
      if (!hub) throw new TRPCError({ code: "SERVICE_UNAVAILABLE", message: "Seller registration isn't available right now. Please try again later." });
      store = await tx.store.create({ data: {
        name: "New seller", ownerName: "", ownerPhone: phone, ownerPhoneVerifiedAt: new Date(),
        onboardingStartedAt: new Date(), sellerType: "store", hubMetroId: hub.id,
        onboardingStatus: "pending", verificationStatus: "unverified",
      } });
    }
    return issueUserSession({ kind: "store", storeId: store.id }, meta, tx);
  });
}
