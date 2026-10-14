-- AlterTable
ALTER TABLE "RefundClaim" ADD COLUMN     "kind" TEXT NOT NULL DEFAULT 'item',
ADD COLUMN     "note" TEXT,
ADD COLUMN     "refundId" TEXT,
ADD COLUMN     "refundedAt" TIMESTAMP(3);

-- AlterTable
ALTER TABLE "Shipment" ADD COLUMN     "packingPhotoAt" TIMESTAMP(3);

-- CreateTable
CREATE TABLE "RefundClaimItem" (
    "id" TEXT NOT NULL,
    "claimId" TEXT NOT NULL,
    "shipmentItemId" TEXT NOT NULL,
    "lineTotalCents" INTEGER NOT NULL,

    CONSTRAINT "RefundClaimItem_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "RefundClaimItem_shipmentItemId_idx" ON "RefundClaimItem"("shipmentItemId");

-- CreateIndex
CREATE UNIQUE INDEX "RefundClaimItem_claimId_shipmentItemId_key" ON "RefundClaimItem"("claimId", "shipmentItemId");

-- AddForeignKey
ALTER TABLE "RefundClaimItem" ADD CONSTRAINT "RefundClaimItem_claimId_fkey" FOREIGN KEY ("claimId") REFERENCES "RefundClaim"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundClaimItem" ADD CONSTRAINT "RefundClaimItem_shipmentItemId_fkey" FOREIGN KEY ("shipmentItemId") REFERENCES "ShipmentItem"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
