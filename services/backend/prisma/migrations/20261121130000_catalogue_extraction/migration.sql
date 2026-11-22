CREATE TABLE "ExtractionJob" (
  "sessionId" TEXT PRIMARY KEY REFERENCES "FilmSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "state" TEXT NOT NULL DEFAULT 'queued',
  "lease" TEXT,
  "leaseUntil" TIMESTAMP(3),
  "attempts" INTEGER NOT NULL DEFAULT 0,
  "message" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "submittedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExtractionJob_state_leaseUntil_idx" ON "ExtractionJob"("state","leaseUntil");
INSERT INTO "ExtractionJob" ("sessionId") SELECT "id" FROM "FilmSession" WHERE "finishedAt" IS NOT NULL;
ALTER TABLE "CatalogueDraft"
  ADD COLUMN "jobId" TEXT REFERENCES "ExtractionJob"("sessionId") ON DELETE CASCADE ON UPDATE CASCADE,
  ADD COLUMN "brand" TEXT,
  ADD COLUMN "frameNames" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "candidateIds" TEXT[] NOT NULL DEFAULT '{}',
  ADD COLUMN "decision" TEXT NOT NULL DEFAULT 'open';
CREATE INDEX "CatalogueDraft_jobId_idx" ON "CatalogueDraft"("jobId");
CREATE TABLE "ExtractionUsage" (
  "id" TEXT PRIMARY KEY, "storeId" TEXT NOT NULL, "model" TEXT NOT NULL,
  "inputBytes" INTEGER NOT NULL, "inputTokens" INTEGER, "outputTokens" INTEGER,
  "micros" INTEGER NOT NULL, "latencyMs" INTEGER, "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX "ExtractionUsage_storeId_createdAt_idx" ON "ExtractionUsage"("storeId","createdAt");
