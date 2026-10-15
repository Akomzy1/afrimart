-- AlterTable
ALTER TABLE "SellerMessage" ADD COLUMN     "dedupeKey" TEXT;

-- CreateIndex
CREATE UNIQUE INDEX "SellerMessage_dedupeKey_key" ON "SellerMessage"("dedupeKey");
