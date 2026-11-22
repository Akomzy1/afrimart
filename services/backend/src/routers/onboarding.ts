import { createHash } from "node:crypto";
import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { prisma } from "../db.js";
import { merchantProcedure, router } from "../trpc.js";

export const onboardingRouter = router({
  state: merchantProcedure.query(({ ctx }) => prisma.store.findUniqueOrThrow({
    where: { id: ctx.storeId },
    select: {
      id: true, name: true, ownerName: true, sellerType: true, onboardingStatus: true,
      verificationStatus: true, ownerPhoneVerifiedAt: true, onboardingProfileAt: true,
      filmSession: { select: { finishedAt: true } },
      onboardingRail: true, onboardingWebsite: true, foodSafetyAttestedAt: true,
      hubMetro: { select: { name: true, state: true } },
      onboardingKits: { orderBy: { issuedAt: "desc" }, select: { id: true, packaging: true, labelPrinterSerial: true, issuedAt: true } },
    },
  })),

  saveProfile: merchantProcedure.input(z.object({
    name: z.string().trim().min(2).max(120), ownerName: z.string().trim().min(2).max(120),
    sellerType: z.enum(["store", "home_seller", "aspiring_entrepreneur"]),
    foodSafetyAttested: z.literal(true),
  })).mutation(async ({ input, ctx }) => {
    const changed = await prisma.store.updateMany({
      where: { id: ctx.storeId, ownerPhoneVerifiedAt: { not: null }, verificationStatus: { not: "verified" }, onboardingStatus: { in: ["pending", "filming"] } },
      data: { name: input.name, ownerName: input.ownerName, sellerType: input.sellerType,
        onboardingProfileAt: new Date(), foodSafetyAttestedAt: new Date() },
    });
    if (!changed.count) throw new TRPCError({ code: "FORBIDDEN", message: "Your store details are under review. Contact AfriMart to change them." });
    return { saved: true };
  }),

  chooseRail: merchantProcedure.input(z.object({
    rail: z.enum(["film", "web"]),
    website: z.string().trim().max(500).optional(),
  })).mutation(async ({ input, ctx }) => {
    let website: string | null = null;
    if (input.rail === "web") {
      try {
        const url = new URL(input.website ?? "");
        if (!["https:", "http:"].includes(url.protocol) || url.username || url.password) throw new Error();
        website = url.toString();
      } catch {
        throw new TRPCError({ code: "BAD_REQUEST", message: "Enter your full website address, starting with https://." });
      }
    }
    const changed = await prisma.store.updateMany({
      where: { id: ctx.storeId, ownerPhoneVerifiedAt: { not: null }, onboardingProfileAt: { not: null },
        onboardingStatus: { in: ["pending", "filming"] } },
      data: { onboardingRail: input.rail, onboardingWebsite: website, onboardingStatus: "filming" },
    });
    if (!changed.count) throw new TRPCError({ code: "FORBIDDEN", message: "Complete your store details before choosing how to add products." });
    return { saved: true };
  }),

  acceptInvite: merchantProcedure.input(z.object({ token: z.string().regex(/^[A-Za-z0-9_-]{43}$/) })).mutation(async ({ input, ctx }) => {
    // Only the verified owner of the invited store can spend it. A leaked link
    // does not grant a session, expose a phone, or select someone else's store.
    const used = await prisma.onboardingInvite.updateMany({
      where: { tokenHash: createHash("sha256").update(input.token).digest("hex"), storeId: ctx.storeId,
        consumedAt: null, expiresAt: { gt: new Date() }, store: { ownerPhoneVerifiedAt: { not: null } } },
      data: { consumedAt: new Date() },
    });
    if (!used.count) throw new TRPCError({ code: "BAD_REQUEST", message: "This invitation has expired, was already used, or belongs to another store. Ask your AfriMart contact for a new link." });
    return { accepted: true };
  }),
});
