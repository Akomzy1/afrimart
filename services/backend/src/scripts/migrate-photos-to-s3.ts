/**
 * Copy the photos in the local development folder into the configured S3
 * bucket, keeping every file's name so no database row changes.
 *
 *   S3_BUCKET=... S3_ACCESS_KEY_ID=... S3_SECRET_ACCESS_KEY=... [S3_ENDPOINT=...] \
 *     npm run migrate:photos --workspace=@afrimart/backend [-- --dry-run]
 *
 * Reads UPLOAD_DIR (or the default .uploads folder). Never deletes anything.
 * Exits non-zero if any file did not read back identical.
 */
import { DEFAULT_PHOTO_ROOT } from "../storage/photos.js";
import { S3Client, S3PhotoStore, assertBucketPrivate, s3ConfigFromEnv } from "../storage/s3.js";
import { migratePhotos } from "../storage/migrate.js";

const config = s3ConfigFromEnv();
if (!config) {
  console.error("No S3 configuration found. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY first.");
  process.exit(2);
}
const store = new S3PhotoStore(new S3Client(config));
const root = process.env.UPLOAD_DIR ?? DEFAULT_PHOTO_ROOT;
const dryRun = process.argv.includes("--dry-run");

await assertBucketPrivate(store.client);
console.log(`${dryRun ? "Would copy" : "Copying"} photos from ${root} to bucket "${config.bucket}"${config.keyPrefix ? ` under ${config.keyPrefix}` : ""}`);
const r = await migratePhotos({ root, store, dryRun });
console.log(`${dryRun ? "would copy" : "copied"} ${r.copied}, already there ${r.alreadyThere}, skipped ${r.skipped.length}, mismatched ${r.mismatched.length}`);
for (const s of r.skipped) console.log(`  skipped (not a stored photo): ${s}`);
for (const m of r.mismatched) console.log(`  MISMATCH: ${m}`);
console.log(r.mismatched.length ? "Some files did not match. Nothing was deleted; look at the list above." : "Done. The local folder was not touched; remove it once you have checked the counts.");
process.exit(r.mismatched.length ? 1 : 0);
