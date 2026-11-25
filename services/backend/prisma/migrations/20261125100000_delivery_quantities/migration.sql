ALTER TABLE "Listing" ADD COLUMN "unitsAvailable" INTEGER CHECK ("unitsAvailable" >= 0);
ALTER TABLE "ShipmentItem" ADD COLUMN "reservedUnits" INTEGER NOT NULL DEFAULT 0 CHECK ("reservedUnits" BETWEEN 0 AND "quantity");

CREATE TABLE "DeliveryReceipt" (
    "storeId" TEXT NOT NULL REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "requestId" TEXT NOT NULL,
    "lines" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY ("storeId", "requestId")
);
