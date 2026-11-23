ALTER TABLE "ExtractionJob" ADD COLUMN "websiteUrl" TEXT;
ALTER TABLE "CatalogueDraft" ADD COLUMN "sourceKey" TEXT;
CREATE UNIQUE INDEX "CatalogueDraft_jobId_sourceKey_key" ON "CatalogueDraft"("jobId", "sourceKey");
