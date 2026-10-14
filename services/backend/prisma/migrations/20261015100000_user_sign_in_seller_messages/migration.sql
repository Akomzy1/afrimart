-- CreateEnum
CREATE TYPE "UserKind" AS ENUM ('buyer', 'store');

-- AlterTable
ALTER TABLE "Store" ADD COLUMN     "ownerPhone" TEXT;

-- CreateTable
CREATE TABLE "SellerMessage" (
    "id" TEXT NOT NULL,
    "storeId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "payoutId" TEXT,
    "amountCents" INTEGER,
    "paidOn" TIMESTAMP(3),
    "orderRefs" TEXT[],
    "readAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SellerMessage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthCode" (
    "id" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL,
    "identifier" TEXT NOT NULL,
    "salt" TEXT NOT NULL,
    "codeHash" TEXT NOT NULL,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "consumedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "UserSession" (
    "id" TEXT NOT NULL,
    "kind" "UserKind" NOT NULL,
    "buyerId" TEXT,
    "storeId" TEXT,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "lastSeenAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revokedAt" TIMESTAMP(3),
    "ip" TEXT,
    "userAgent" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "UserSession_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "SellerMessage_payoutId_key" ON "SellerMessage"("payoutId");

-- CreateIndex
CREATE INDEX "SellerMessage_storeId_createdAt_idx" ON "SellerMessage"("storeId", "createdAt");

-- CreateIndex
CREATE INDEX "AuthCode_kind_identifier_createdAt_idx" ON "AuthCode"("kind", "identifier", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "UserSession_tokenHash_key" ON "UserSession"("tokenHash");

-- CreateIndex
CREATE INDEX "UserSession_buyerId_idx" ON "UserSession"("buyerId");

-- CreateIndex
CREATE INDEX "UserSession_storeId_idx" ON "UserSession"("storeId");

-- CreateIndex
CREATE UNIQUE INDEX "Store_ownerPhone_key" ON "Store"("ownerPhone");

-- AddForeignKey
ALTER TABLE "SellerMessage" ADD CONSTRAINT "SellerMessage_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SellerMessage" ADD CONSTRAINT "SellerMessage_payoutId_fkey" FOREIGN KEY ("payoutId") REFERENCES "Payout"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_buyerId_fkey" FOREIGN KEY ("buyerId") REFERENCES "Buyer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "UserSession" ADD CONSTRAINT "UserSession_storeId_fkey" FOREIGN KEY ("storeId") REFERENCES "Store"("id") ON DELETE SET NULL ON UPDATE CASCADE;

