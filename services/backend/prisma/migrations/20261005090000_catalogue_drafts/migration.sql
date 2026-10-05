-- CreateEnum
CREATE TYPE "CatalogueDraftStatus" AS ENUM ('pending_review', 'approved', 'rejected');

-- CreateTable
CREATE TABLE "CatalogueDraft" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "rawText" TEXT NOT NULL,
    "suggestedName" TEXT NOT NULL,
    "suggestedPriceCents" INTEGER,
    "packSize" TEXT,
    "temperatureClass" "TemperatureClass" NOT NULL DEFAULT 'ambient',
    "confidence" DOUBLE PRECISION NOT NULL,
    "matchedProductId" TEXT,
    "status" "CatalogueDraftStatus" NOT NULL DEFAULT 'pending_review',
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CatalogueDraft_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "CatalogueDraft_status_confidence_idx" ON "CatalogueDraft"("status", "confidence");

-- AddForeignKey
ALTER TABLE "CatalogueDraft" ADD CONSTRAINT "CatalogueDraft_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

