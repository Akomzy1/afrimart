ALTER TABLE "Shipment" ADD COLUMN "deliveredAt" TIMESTAMP(3);

-- Prefer an applied carrier scan. For older manual confirmations the last
-- recorded shipment update gives a conservative start for the refund window.
UPDATE "Shipment" s
SET "deliveredAt" = COALESCE((
    SELECT e."occurredAt" FROM "WebhookEvent" e
    WHERE e."shipmentId" = s.id AND lower(trim(e."rawStatus")) = 'delivered'
      AND e."processedAt" IS NOT NULL AND e."ignoredReason" IS NULL
    ORDER BY e."processedAt" DESC, e.id DESC LIMIT 1
), s."updatedAt")
WHERE s.status = 'delivered';

CREATE FUNCTION stamp_shipment_delivery() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF NEW.status <> 'delivered' THEN
        NEW."deliveredAt" := NULL;
    ELSIF TG_OP = 'UPDATE' AND OLD.status = 'delivered' THEN
        NEW."deliveredAt" := OLD."deliveredAt";
    ELSE
        NEW."deliveredAt" := COALESCE(NEW."deliveredAt", clock_timestamp() AT TIME ZONE 'UTC');
    END IF;
    RETURN NEW;
END;
$$;

CREATE TRIGGER stamp_shipment_delivery BEFORE INSERT OR UPDATE OF status, "deliveredAt"
ON "Shipment" FOR EACH ROW EXECUTE FUNCTION stamp_shipment_delivery();
