ALTER TABLE "CarrierAdjustment" ADD COLUMN "appliedCents" INTEGER NOT NULL DEFAULT 0;

UPDATE "CarrierAdjustment" SET "appliedCents" = "amountCents" WHERE "settledPayoutId" IS NOT NULL;

ALTER TABLE "CarrierAdjustment" ADD CONSTRAINT "CarrierAdjustment_appliedCents_bounds"
    CHECK ("appliedCents" BETWEEN 0 AND "amountCents");
