import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { resolve } from "node:path";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { S3Client, S3PhotoStore, s3ConfigFromEnv } from "../storage/s3.js";

export async function verifyVersionedStorage(client: S3Client) {
  const name = randomBytes(16).toString("hex") + ".jpg";
  const key = client.config.keyPrefix + "shelf/" + name;
  const store = new S3PhotoStore(client);
  const versions = new Map<string, Buffer>();
  console.log("Testing synthetic shelf object", key);

  try {
    for (const background of ["green", "blue"]) {
      const bytes = await sharp({ create: { width: 16, height: 16, channels: 3, background } }).jpeg().toBuffer();
      const version = await client.putObject(key, bytes, "image/jpeg");
      assert.ok(version && version !== "null", "The provider must issue a version ID for each upload.");
      assert.ok(!versions.has(version), "The two uploads must have distinct version IDs.");
      versions.set(version, bytes);
      if (versions.size === 1) {
        const status = await client.anonymousStatus(key);
        assert.ok(status === 403 || status === 404, "Anonymous access should return 403 or 404. Received " + status);
      }
    }
    for (const [version, original] of versions) {
      assert.deepEqual(await client.getObject(key, version), original, "Each version ID must return its original bytes after both uploads.");
    }
    await store.removeShelfFrame(name);
    assert.equal(await store.has("shelf", name), false, "The current shelf object still exists.");
    for (const version of versions.keys()) {
      assert.equal(await client.getObject(key, version), null, "A prior shelf version is still readable after deletion.");
    }
  } catch (error) {
    // If verification exposed a hidden version, remove it explicitly while
    // preserving the failed check. This path only touches this run's key.
    try {
      for (const version of versions.keys()) await client.deleteObject(key, version);
      await store.removeShelfFrame(name);
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "Staging check and cleanup failed for " + key + ": " + String(error) + "; cleanup: " + String(cleanupError));
    }
    throw error;
  }
}

async function main() {
  const config = s3ConfigFromEnv();
  if (!config) throw new Error("Configure the private staging bucket and credentials to run this check.");
  await verifyVersionedStorage(new S3Client(config));
  console.log("PASS anonymous access denied and both stored versions removed.");
}

if (process.argv[1] && pathToFileURL(resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
