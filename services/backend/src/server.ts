import { runExtractionWorker } from "./catalogue/worker.js";
import { runShelfRetention } from "./catalogue/photoRetention.js";
import { buildServer } from "./app.js";
import { runMerchantAlertWorker } from "./notifications/merchantAlerts.js";
import { assertPhotoSigningConfigured } from "./storage/access.js";
import { assertPhotoStorageReady } from "./storage/store.js";

// Refuse to start without what has to be true before a photo or a session is handled.
await assertPhotoStorageReady();
assertPhotoSigningConfigured();

const server = await buildServer();
const extraction = new AbortController();
void runShelfRetention(extraction.signal);
const alerts = runMerchantAlertWorker(extraction.signal);
if (process.env.SHELF_EXTRACTION_ENABLED === "yes") void runExtractionWorker(extraction.signal);
server.addHook("onClose", async () => { extraction.abort(); await alerts; });
const port = Number(process.env.PORT ?? 4000);

server
  .listen({ port, host: "0.0.0.0" })
  .then(() => server.log.info(`AfriMart backend listening on :${port}`))
  .catch((err) => {
    server.log.error(err);
    process.exit(1);
  });
