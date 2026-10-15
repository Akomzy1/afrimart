/**
 * The S3 photo store against a real S3-compatible server (MinIO), not a fake.
 *
 * Start MinIO, then run this with its endpoint and credentials:
 *   docker run -d --name afrimart-minio -p 9100:9000 \
 *     -e MINIO_ROOT_USER=afrimartminio -e MINIO_ROOT_PASSWORD=afrimartminio-secret minio/minio server /data
 *   S3_ENDPOINT=http://localhost:9100 S3_BUCKET=afrimart-verify S3_ACCESS_KEY_ID=afrimartminio \
 *     S3_SECRET_ACCESS_KEY=afrimartminio-secret npm run verify:storage --workspace=@afrimart/backend
 *
 * Creates the bucket if it is missing (MinIO buckets are private by default) and
 * removes every object it writes. Proves the hand-written request signing is
 * accepted by a real server, that photos round-trip sanitised, that the bucket
 * is refused or accepted by the privacy check correctly, and that the whole path
 * works through the API's own signed-link route.
 */
import Fastify from "fastify";
import sharp from "sharp";
import { S3Client, S3PhotoStore, assertBucketPrivate, s3ConfigFromEnv } from "../storage/s3.js";
import { registerPhotoRoute } from "../storage/route.js";
import { signedPhotoUrl } from "../storage/access.js";
import { decodeUpload } from "../storage/photos.js";
import { migratePhotos } from "../storage/migrate.js";

let failures = 0;
const check = (label: string, pass: boolean, detail = "") => {
  if (!pass) failures++;
  console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
};

const config = s3ConfigFromEnv();
if (!config || !config.endpoint) {
  console.error("Set S3_ENDPOINT, S3_BUCKET, S3_ACCESS_KEY_ID and S3_SECRET_ACCESS_KEY for a MinIO (or other S3-compatible) server.");
  process.exit(2);
}
const client = new S3Client({ ...config, keyPrefix: "verify/", serverSideEncryption: null });
const store = new S3PhotoStore(client);
const made: { kind: "packing" | "claim" | "document"; name: string }[] = [];

try {
  console.log(`=== a real S3-compatible server at ${config.endpoint}, bucket ${config.bucket} ===`);
  await client.ensureBucket();
  check("the bucket exists (made if it was missing)", true);

  const jpeg = await sharp({ create: { width: 80, height: 60, channels: 3, background: "#aa8855" } })
    .jpeg()
    .withExif({ IFD0: { Make: "ZZREALMAKE" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 26/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 39/1" } })
    .toBuffer();
  check("the fixture carries camera and GPS data", jpeg.includes(Buffer.from("ZZREALMAKE")));

  for (const kind of ["document", "claim", "packing"] as const) {
    const path = await store.put(kind, jpeg);
    const name = path.split("/").pop()!;
    made.push({ kind, name });
    const back = await store.read(kind, name);
    check(`${kind}: written, signed requests accepted, read back`, path.startsWith(`/photos/${kind}/`) && back !== null && back.length > 100);
    check(`${kind}: nothing from the camera or GPS survived`, back !== null && !back.includes(Buffer.from("ZZREALMAKE")) && !back.includes(Buffer.from("GPS")) && (await sharp(back).metadata()).exif === undefined);
    check(`${kind}: it is a JPEG`, back?.subarray(0, 3).toString("hex") === "ffd8ff");
  }

  check("a missing object is null, not an error", (await store.read("claim", "00000000000000000000000000000000.jpg")) === null);
  check("a photo is only found under the kind it was stored with", (await store.read("claim", made.find((m) => m.kind === "document")!.name)) === null);

  const doc = made.find((m) => m.kind === "document")!;
  // A real S3 or R2 bucket, or MinIO, is private by default and this should pass. A mock
  // server such as s3rver serves anonymous requests by design; against one the
  // right thing to prove is that the start-up check notices and refuses.
  const anonymous = await client.anonymousStatus(`verify/document/${doc.name}`);
  if (anonymous === 200) {
    let refusal = "";
    try {
      await assertBucketPrivate(client);
    } catch (e) {
      refusal = (e as Error).message;
    }
    check("this server hands objects to anyone, and the start-up privacy check refuses it", /serves objects to anonymous requests/.test(refusal), refusal.slice(0, 80));
    console.log("   (this server is public by design, so the rest of the run proves the store, not the bucket's privacy)");
  } else {
    check("an anonymous request for a stored object is refused", true, String(anonymous));
    await assertBucketPrivate(client);
    check("the start-up privacy check accepts this bucket", true);
  }
  check("the privacy check leaves no probe object behind", (await client.headObject("verify/.private-check/none")) === null);

  const wrong = new S3Client({ ...config, secretAccessKey: "not-the-secret" });
  let refused = "";
  try {
    await wrong.putObject("verify/x", Buffer.from("x"), "text/plain");
  } catch (e) {
    refused = (e as Error).message;
  }
  if (refused) {
    check("a wrong secret is refused by the server", /refused a write \(403\)/.test(refused), refused);
  } else {
    // s3rver checks the access key and the clock but not the signature value, so it
    // cannot say. MinIO, S3 and R2 do. The signer itself is pinned in s3.test.ts
    // against AWS's published examples and against the aws4 library.
    console.log("   (this server does not check signature values, so it cannot refuse a wrong secret; not counted)");
    await client.deleteObject("verify/x").catch(() => undefined);
  }

  console.log("\n=== through the API's own signed-link route ===");
  const server = Fastify();
  registerPhotoRoute(server, store);
  const link = signedPhotoUrl(`/photos/document/${doc.name}`)!;
  const served = await server.inject({ method: "GET", url: link });
  check("a signed link serves the licence photo from the bucket", served.statusCode === 200 && served.headers["content-type"] === "image/jpeg" && served.rawPayload.length > 100);
  check("it is never cached", String(served.headers["cache-control"]).includes("no-store"));
  check("the bare path serves nothing", (await server.inject({ method: "GET", url: `/photos/document/${doc.name}` })).statusCode === 404);
  const tampered = link.replace(/exp=(\d+)/, (_, n) => `exp=${Number(n) + 99999}`);
  check("a tampered link serves nothing", (await server.inject({ method: "GET", url: tampered })).statusCode === 404);

  console.log("\n=== moving the development folder across ===");
  const { mkdtemp, mkdir, writeFile, rm } = await import("node:fs/promises");
  const os = await import("node:os");
  const path = await import("node:path");
  const root = await mkdtemp(path.join(os.tmpdir(), "afrimart-verify-migrate-"));
  try {
    await mkdir(path.join(root, "claim"), { recursive: true });
    const sanitised = decodeUpload((await store.read("claim", made.find((m) => m.kind === "claim")!.name))!.toString("base64"));
    await writeFile(path.join(root, "claim", "99999999999999999999999999999999.jpg"), sanitised);
    made.push({ kind: "claim", name: "99999999999999999999999999999999.jpg" });
    const first = await migratePhotos({ root, store });
    const second = await migratePhotos({ root, store });
    check("a local file is copied across and read back identical", first.copied === 1 && first.mismatched.length === 0, JSON.stringify(first));
    check("a second run copies nothing", second.copied === 0 && second.alreadyThere === 1);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
} finally {
  for (const m of made) await client.deleteObject(`verify/${m.kind}/${m.name}`).catch(() => undefined);
}

console.log(failures === 0 ? "\nAll storage checks passed against a real S3-compatible server." : `\n${failures} storage check(s) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
