import { isDeepStrictEqual } from "node:util";
import { TRPCError } from "@trpc/server";
import type { Prisma } from "@prisma/client";
import { z } from "zod";
import { prisma } from "../db.js";
import { normalize, packKey } from "./extraction.js";

type Label = { name: string; packSize: string | null; units: number | null };
type Product = { id: string; canonicalProduct: { canonicalName: string; aliases: { alias: string }[]; packSize: string } };

export function matchDelivery(labels: Label[], listings: Product[]) {
  return labels.map(label => {
    const matches = listings.filter(({ canonicalProduct: p }) =>
      (!label.packSize || packKey(label.packSize) === packKey(p.packSize)) &&
      [p.canonicalName, ...p.aliases.map(a => a.alias)].some(name => normalize(name) === normalize(label.name)));
    return { ...label, listingId: matches.length === 1 ? matches[0]!.id : null };
  });
}

export const deliveryInput = z.object({
  requestId: z.string().uuid(),
  lines: z.array(z.object({
    listingId: z.string().min(1), units: z.number().int().min(1).max(100000),
    opening: z.number().int().min(0).max(1000000).nullable(),
  })).min(1).max(50),
});

export async function receiveDelivery(storeId: string, input: z.infer<typeof deliveryInput>) {
  const lines = [...input.lines].sort((a, b) => a.listingId < b.listingId ? -1 : a.listingId > b.listingId ? 1 : 0);
  if (new Set(lines.map(l => l.listingId)).size !== lines.length) {
    throw new TRPCError({ code: "BAD_REQUEST", message: "Combine counts for the same listing." });
  }
  return prisma.$transaction(async tx => {
    const receipt = await tx.deliveryReceipt.createMany({ data: { storeId, requestId: input.requestId, lines }, skipDuplicates: true });
    if (!receipt.count) {
      const prior = await tx.deliveryReceipt.findUniqueOrThrow({ where: { storeId_requestId: { storeId, requestId: input.requestId } } });
      if (!isDeepStrictEqual(prior.lines, lines)) throw new TRPCError({ code: "CONFLICT", message: "This delivery was already confirmed with different quantities." });
    } else {
      for (const line of lines) {
        const changed = await tx.$executeRaw`
          UPDATE "Listing" SET "unitsAvailable" = COALESCE("unitsAvailable", ${line.opening}::integer) + ${line.units},
            "stockStatus" = CASE WHEN "stockStatus" = 'out_of_stock' THEN 'in_stock'::"StockStatus" ELSE "stockStatus" END,
            "updatedAt" = CURRENT_TIMESTAMP AT TIME ZONE 'UTC'
          WHERE "id" = ${line.listingId} AND "storeId" = ${storeId}
            AND ("unitsAvailable" IS NULL) = (${line.opening}::integer IS NOT NULL)`;
        if (!changed) throw new TRPCError({ code: "CONFLICT", message: "The stock record changed. Review the product and its opening count again." });
      }
    }
    return { units: lines.reduce((sum, line) => sum + line.units, 0), products: lines.length };
  });
}

/** Return only units deducted at checkout, once per unshipped line. */
export async function releaseReservations(tx: Prisma.TransactionClient, shipment: Prisma.ShipmentWhereInput) {
  const items = await tx.shipmentItem.findMany({ where: { shipment, reservedUnits: { gt: 0 } },
    select: { id: true, listingId: true, reservedUnits: true }, orderBy: [{ listingId: "asc" }, { id: "asc" }] });
  for (const item of items) {
    const released = await tx.shipmentItem.updateMany({ where: { id: item.id, reservedUnits: item.reservedUnits }, data: { reservedUnits: 0 } });
    if (released.count) await tx.listing.update({ where: { id: item.listingId }, data: { unitsAvailable: { increment: item.reservedUnits } } });
  }
}
