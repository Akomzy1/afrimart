-- CreateEnum
CREATE TYPE "BadgeKind" AS ENUM ('diaspora_owned', 'imported_direct', 'made_in_usa_african_brand');

-- CreateEnum
CREATE TYPE "BadgeStatus" AS ENUM ('applied', 'approved', 'rejected', 'revoked');

-- CreateEnum
CREATE TYPE "EnforcementLevel" AS ENUM ('warning', 'reduced_visibility', 'suspended', 'delisted', 'cleared');

-- AlterTable
ALTER TABLE "Listing" ADD COLUMN     "expiresOn" TIMESTAMP(3),
ADD COLUMN     "shortDatedDisclosed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "SellerBadge" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" "BadgeKind" NOT NULL,
    "status" "BadgeStatus" NOT NULL DEFAULT 'applied',
    "evidence" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerBadge_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerEnforcement" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "level" "EnforcementLevel" NOT NULL,
    "reason" TEXT NOT NULL,
    "actorEmail" TEXT,
    "scoreAtTime" DOUBLE PRECISION,
    "ordersAtTime" INTEGER,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerEnforcement_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerBadge_storeId_kind_key" ON "SellerBadge"("storeId", "kind");

-- CreateIndex
CREATE INDEX "SellerEnforcement_storeId_createdAt_idx" ON "SellerEnforcement"("storeId", "createdAt");

-- AddForeignKey
ALTER TABLE "SellerBadge" ADD CONSTRAINT "SellerBadge_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerEnforcement" ADD CONSTRAINT "SellerEnforcement_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

