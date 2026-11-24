ALTER TYPE "ShipmentStatus" ADD VALUE 'declined';
ALTER TABLE "Shipment" ADD COLUMN "declineReason" VARCHAR(500);
