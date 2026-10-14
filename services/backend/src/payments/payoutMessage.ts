import type { Payout, Prisma, PrismaClient } from "@prisma/client";


type Tx = Prisma.TransactionClient | PrismaClient;

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Tell a seller, in their AfriMart thread, that a payout has been made: how
 * much, when, and which order it covers. This is how a seller sees their
 * earnings; there is no earnings screen.
 *
 * Called inside the transaction that marks the payout paid, so the two cannot
 * come apart, and written once per payout (the payout id is unique on the
 * message), so releasing the same payout again cannot post a second note.
 */
export async function postPayoutMessage(tx: Tx, payout: Pick<Payout, "id" | "storeId" | "orderId" | "netCents">, paidAt: Date) {
  // The reference a seller sees on their orders (see merchant.inbox), not the buyer-facing one.
  const orderRef = `#${payout.orderId.slice(-4).toUpperCase()}`;
  return tx.sellerMessage.upsert({
    where: { payoutId: payout.id },
    update: {},
    create: {
      storeId: payout.storeId,
      kind: "payout",
      payoutId: payout.id,
      amountCents: payout.netCents,
      paidOn: paidAt,
      orderRefs: [orderRef],
      body: `Your payout of ${money(payout.netCents)} was sent on ${day(paidAt)}. It covers order ${orderRef}.`,
    },
  });
}
