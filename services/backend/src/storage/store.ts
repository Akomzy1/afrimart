import { productionSignals } from "../runtime.js";
import { DEFAULT_PHOTO_ROOT, LocalPhotoStore, PhotoRejected, type PhotoStore } from "./photos.js";
import { S3Client, S3PhotoStore, assertBucketPrivate, s3ConfigFromEnv } from "./s3.js";

/**
 * Which photo store this process uses, decided once from the environment.
 *
 * S3 variables present: an S3-compatible bucket (AWS S3, Cloudflare R2, MinIO),
 * durable and private. None present: a folder on this machine, which is for
 * development only. A half-set S3 configuration is an error, not a fallback,
 * because falling back to the local disk would quietly put licences somewhere
 * a redeploy erases.
 */
export function createPhotoStore(env: NodeJS.ProcessEnv = process.env): PhotoStore {
  const s3 = s3ConfigFromEnv(env);
  return s3 ? new S3PhotoStore(new S3Client(s3)) : new LocalPhotoStore(env.UPLOAD_DIR ?? DEFAULT_PHOTO_ROOT);
}

/** The store in use. */
export const photoStore: PhotoStore = createPhotoStore();

/**
 * Licence documents are kept only in durable, private storage. On a development
 * machine the local folder is accepted so the flow can be built and tested;
 * anywhere else, without an object store, the document is refused with a
 * message a seller can read.
 */
export function assertCanKeepDocuments(store: PhotoStore = photoStore, env: NodeJS.ProcessEnv = process.env): void {
  if (store.durable || productionSignals(env).length === 0) return;
  throw new PhotoRejected("We can't take documents right now. Please try again later.");
}

/**
 * Called at start-up. Outside development the server will not run without a
 * durable object store, because claim and packing photos would otherwise be
 * lost on the next deploy and licence documents refused. With a bucket, it
 * also proves the bucket is not public, by asking for an object with no
 * credentials.
 */
export async function assertPhotoStorageReady(store: PhotoStore = photoStore, env: NodeJS.ProcessEnv = process.env): Promise<void> {
  if (store instanceof S3PhotoStore) {
    await assertBucketPrivate(store.client);
    return;
  }
  if (productionSignals(env).length > 0) {
    throw new Error(
      "Photos need durable private storage here. Set S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY " +
        "(and S3_ENDPOINT for Cloudflare R2 or another S3-compatible store).",
    );
  }
}
