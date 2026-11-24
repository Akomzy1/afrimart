CREATE TYPE "PickupState" AS ENUM ('awaiting_carrier', 'test_scheduled', 'cancelled');

CREATE TABLE "ShipmentPickup" (
    "shipmentId" TEXT PRIMARY KEY REFERENCES "Shipment"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "requestedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "state" "PickupState" NOT NULL DEFAULT 'awaiting_carrier',
    "windowStart" TIMESTAMP(3),
    "windowEnd" TIMESTAMP(3),
    CHECK (("windowStart" IS NULL) = ("windowEnd" IS NULL)),
    CHECK ("windowEnd" > "windowStart"),
    CHECK ("state" <> 'test_scheduled' OR "windowStart" IS NOT NULL),
    CHECK ("state" <> 'awaiting_carrier' OR "windowStart" IS NULL)
);
