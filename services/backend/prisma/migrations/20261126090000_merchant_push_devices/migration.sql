CREATE TABLE "MerchantPushDevice" (
    "sessionId" TEXT PRIMARY KEY REFERENCES "UserSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
    "endpoint" TEXT NOT NULL UNIQUE,
    "p256dh" TEXT NOT NULL,
    "auth" TEXT NOT NULL,
    "applicationKey" TEXT NOT NULL
);
