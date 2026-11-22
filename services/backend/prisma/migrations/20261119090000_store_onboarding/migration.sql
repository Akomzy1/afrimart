ALTER TABLE "Store"
  ADD COLUMN "ownerPhoneVerifiedAt" TIMESTAMP(3),
  ADD COLUMN "ownerPhoneVersion" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "onboardingStartedAt" TIMESTAMP(3),
  ADD COLUMN "onboardingProfileAt" TIMESTAMP(3),
  ADD COLUMN "onboardingRail" TEXT,
  ADD COLUMN "onboardingWebsite" TEXT;

ALTER TABLE "AuthCode"
  ADD COLUMN "purpose" TEXT NOT NULL DEFAULT 'sign_in',
  ADD COLUMN "storeIdAtIssue" TEXT,
  ADD COLUMN "storePhoneVersion" INTEGER;

-- Old store codes were not bound to a phone assignment. Require a fresh code.
UPDATE "AuthCode" SET "consumedAt" = CURRENT_TIMESTAMP WHERE "kind" = 'store' AND "consumedAt" IS NULL;
UPDATE "UserSession" SET "revokedAt" = CURRENT_TIMESTAMP WHERE "kind" = 'store' AND "revokedAt" IS NULL;

CREATE TABLE "OnboardingInvite" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storeId" TEXT NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "tokenHash" TEXT NOT NULL,
  "createdById" TEXT NOT NULL REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "expiresAt" TIMESTAMP(3) NOT NULL,
  "consumedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX "OnboardingInvite_tokenHash_key" ON "OnboardingInvite"("tokenHash");
CREATE INDEX "OnboardingInvite_storeId_idx" ON "OnboardingInvite"("storeId");

CREATE TABLE "OnboardingKit" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "storeId" TEXT NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "packaging" TEXT NOT NULL,
  "labelPrinterSerial" TEXT NOT NULL,
  "issuedAt" TIMESTAMP(3) NOT NULL,
  "recordedById" TEXT NOT NULL REFERENCES "StaffUser"("id") ON DELETE RESTRICT ON UPDATE CASCADE,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "OnboardingKit_storeId_issuedAt_idx" ON "OnboardingKit"("storeId", "issuedAt");
