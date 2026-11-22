-- Existing frames did not record upload time. A session's start is a
-- conservative lower bound. Detached legacy uploads already have cleanup leases.
ALTER TABLE "ShelfFrame" ADD COLUMN "uploadedAt" TIMESTAMP(3);
UPDATE "ShelfFrame" s SET "uploadedAt" = f."createdAt" FROM "FilmSession" f WHERE f.id = s."sessionId";
UPDATE "ShelfFrame" SET "uploadedAt" = COALESCE("deleteAfter" - interval '1 hour', CURRENT_TIMESTAMP - interval '30 days') WHERE "uploadedAt" IS NULL;
ALTER TABLE "ShelfFrame" ALTER COLUMN "uploadedAt" SET NOT NULL, ALTER COLUMN "uploadedAt" SET DEFAULT CURRENT_TIMESTAMP;
CREATE INDEX "ShelfFrame_uploadedAt_idx" ON "ShelfFrame"("uploadedAt");
CREATE FUNCTION keep_shelf_upload_time() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NEW."uploadedAt" IS DISTINCT FROM OLD."uploadedAt" THEN RAISE EXCEPTION 'Shelf upload time is immutable'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_shelf_upload BEFORE UPDATE OF "uploadedAt" ON "ShelfFrame" FOR EACH ROW EXECUTE FUNCTION keep_shelf_upload_time();
ALTER TABLE "CatalogueDraft" ADD COLUMN "photoRequestId" TEXT;

-- Queue photos from pre-existing, already extracted sessions whose final link was resolved.
UPDATE "ShelfFrame" f SET "sessionId" = NULL, "deleteAfter" = CURRENT_TIMESTAMP
FROM "ExtractionJob" j WHERE j."sessionId" = f."sessionId" AND j.state = 'ready'
AND NOT EXISTS (SELECT FROM "CatalogueDraft" d WHERE d."jobId" = j."sessionId" AND d.status = 'pending_review' AND f.name = ANY(d."frameNames"));
