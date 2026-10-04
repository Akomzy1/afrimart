-- AlterTable
ALTER TABLE "CanonicalProduct" ADD COLUMN     "heightIn" DOUBLE PRECISION NOT NULL DEFAULT 4,
ADD COLUMN     "lengthIn" DOUBLE PRECISION NOT NULL DEFAULT 8,
ADD COLUMN     "widthIn" DOUBLE PRECISION NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "heightIn" DOUBLE PRECISION NOT NULL DEFAULT 4,
ADD COLUMN     "lengthIn" DOUBLE PRECISION NOT NULL DEFAULT 8,
ADD COLUMN     "widthIn" DOUBLE PRECISION NOT NULL DEFAULT 6;

-- AlterTable
ALTER TABLE "Payout" ADD COLUMN     "adjustmentsCents" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN     "heldUntil" TIMESTAMP(3),
ADD COLUMN     "holdReason" TEXT;

-- CreateTable
CREATE TABLE "CarrierAdjustment" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "carrierReference" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "reason" TEXT NOT NULL,
    "declaredWeightOz" DOUBLE PRECISION NOT NULL,
    "actualWeightOz" DOUBLE PRECISION NOT NULL,
    "settledPayoutId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CarrierAdjustment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RefundClaim" (
    "id" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "shipmentId" TEXT,
    "reason" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "photoUrl" TEXT,
    "status" TEXT NOT NULL DEFAULT 'manual_review',
    "recoveryTarget" TEXT,
    "recoveredCents" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMP(3),

    CONSTRAINT "RefundClaim_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "CarrierAdjustment_carrierReference_key" ON "CarrierAdjustment"("carrierReference");

-- CreateIndex
CREATE INDEX "CarrierAdjustment_storeId_settledPayoutId_idx" ON "CarrierAdjustment"("storeId", "settledPayoutId");

-- CreateIndex
CREATE INDEX "RefundClaim_buyerId_createdAt_idx" ON "RefundClaim"("buyerId", "createdAt");

-- AddForeignKey
ALTER TABLE "CarrierAdjustment" ADD CONSTRAINT "CarrierAdjustment_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RefundClaim" ADD CONSTRAINT "RefundClaim_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

