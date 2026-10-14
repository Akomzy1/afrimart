-- CreateEnum
CREATE TYPE "ControlledCategory" AS ENUM ('meat', 'poultry', 'fish', 'dairy');

-- CreateEnum
CREATE TYPE "KitchenLicenceStatus" AS ENUM ('applied', 'approved', 'rejected', 'revoked');

-- AlterTable
ALTER TABLE "CanonicalProduct" ADD COLUMN     "controlledCategory" "ControlledCategory";

-- CreateTable
CREATE TABLE "KitchenLicence" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "status" "KitchenLicenceStatus" NOT NULL DEFAULT 'applied',
    "licenceNumber" TEXT NOT NULL,
    "issuingAuthority" TEXT NOT NULL,
    "evidence" TEXT,
    "reviewNote" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewedByEmail" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "KitchenLicence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SellerCategoryControl" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "category" "ControlledCategory" NOT NULL,
    "disabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "SellerCategoryControl_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PlatformCategoryControl" (
    "category" "ControlledCategory" NOT NULL,
    "disabled" BOOLEAN NOT NULL,
    "reason" TEXT NOT NULL,
    "actorEmail" TEXT NOT NULL,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PlatformCategoryControl_pkey" PRIMARY KEY ("category")
);

-- CreateTable
CREATE TABLE "PermitConfirmation" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "category" "ControlledCategory" NOT NULL,
    "statementVersion" TEXT NOT NULL,
    "confirmedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PermitConfirmation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "KitchenLicence_storeId_key" ON "KitchenLicence"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "SellerCategoryControl_storeId_category_key" ON "SellerCategoryControl"("storeId", "category");

-- CreateIndex
CREATE UNIQUE INDEX "PermitConfirmation_storeId_category_key" ON "PermitConfirmation"("storeId", "category");

-- AddForeignKey
ALTER TABLE "KitchenLicence" ADD CONSTRAINT "KitchenLicence_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerCategoryControl" ADD CONSTRAINT "SellerCategoryControl_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PermitConfirmation" ADD CONSTRAINT "PermitConfirmation_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Backfill: products already filed under the one category that is unambiguously
-- a controlled one. Anything else (meat, poultry, dairy) did not exist in the
-- catalogue before this migration and is classified when it is added.
UPDATE "CanonicalProduct" SET "controlledCategory" = 'fish' WHERE "category" = 'Fish & seafood';
