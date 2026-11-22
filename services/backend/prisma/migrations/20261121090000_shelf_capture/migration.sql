CREATE TABLE "FilmSession" (
  "id" TEXT PRIMARY KEY,
  "storeId" TEXT NOT NULL UNIQUE REFERENCES "Store"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "finishedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE "ShelfFrame" (
  "name" TEXT PRIMARY KEY,
  "sessionId" TEXT REFERENCES "FilmSession"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  "shelf" INTEGER NOT NULL,
  "position" INTEGER NOT NULL,
  "passId" TEXT NOT NULL,
  "deleteAfter" TIMESTAMP(3)
);
CREATE UNIQUE INDEX "ShelfFrame_sessionId_shelf_position_key" ON "ShelfFrame"("sessionId","shelf","position");
CREATE INDEX "ShelfFrame_sessionId_deleteAfter_idx" ON "ShelfFrame"("sessionId","deleteAfter");
