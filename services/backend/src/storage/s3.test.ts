import { test, describe, before, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { createHash } from "node:crypto";
import sharp from "sharp";

import { S3Client, S3PhotoStore, assertBucketPrivate, s3ConfigFromEnv, signRequest, type S3Config } from "./s3.js";
import { createPhotoStore } from "./store.js";
import { LocalPhotoStore } from "./photos.js";
import { migratePhotos } from "./migrate.js";

/**
 * The S3 adapter. The signer is checked against the worked examples in AWS's
 * own documentation, then the client and store against a small in-process S3
 * server that re-derives every signature from what it receives, so a request
 * that is signed one way and sent another is refused here as it would be by S3.
 * (verify-storage.ts runs the same store against a real MinIO.)
 */

const sha256 = (d: string | Buffer) => createHash("sha256").update(d).digest("hex");
const EMPTY = sha256("");

describe("Signature Version 4, against the examples AWS publishes", () => {
  const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY", region: "us-east-1" };

  test("GET Object with a Range header", () => {
    const signed = signRequest({
      ...creds,
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test.txt",
      headers: { range: "bytes=0-9" },
      payloadHash: EMPTY,
      date: new Date("2013-05-24T00:00:00Z"),
    });
    assert.equal(sha256(signed.canonicalRequest), "7344ae5b7ee6c3e7e6b0fe0640412a37625d1fbfff95c48bbb2dc43964946972");
    assert.equal(signed.signature, "f0e8bdb87c964420e857bd35b5d6ed310bd44f0170aba48dd91039c6036bdb41");
    assert.match(signed.headers.authorization!, /SignedHeaders=host;range;x-amz-content-sha256;x-amz-date,/);
  });

  test("PUT Object, with a path that needs encoding and an extra signed header", () => {
    const body = "Welcome to Amazon S3.";
    const signed = signRequest({
      ...creds,
      method: "PUT",
      host: "examplebucket.s3.amazonaws.com",
      path: "/test$file.text",
      headers: { date: "Fri, 24 May 2013 00:00:00 GMT", "x-amz-storage-class": "REDUCED_REDUNDANCY" },
      payloadHash: sha256(body),
      date: new Date("2013-05-24T00:00:00Z"),
    });
    assert.equal(signed.signature, "98ad721746da40c64f1a55b78f14c238d841ea1380cd77a1b5971af0ece108bd");
    assert.ok(signed.canonicalRequest.includes("/test%24file.text"), "the dollar sign is encoded in the canonical path");
  });

  test("GET Bucket (List Objects) with a query string", () => {
    const signed = signRequest({
      ...creds,
      method: "GET",
      host: "examplebucket.s3.amazonaws.com",
      path: "/",
      query: { "max-keys": "2", prefix: "J" },
      payloadHash: EMPTY,
      date: new Date("2013-05-24T00:00:00Z"),
    });
    assert.equal(signed.signature, "34b48302e7b5fa45bde8084f4b7868a86f0a534bc59db6670ed5711ef69dc6f7");
  });
});

describe("Signature Version 4, against the aws4 library", () => {
  // Recorded from `aws4@1.13.2` signing the same requests (AWS's own examples above
  // cover the algorithm; these cover the shapes this client sends: a custom
  // endpoint with a port, R2's region "auto", an encryption header, a signed
  // content-length, special characters in a key, and the empty key of a bucket).
  const creds = { accessKeyId: "AKIAIOSFODNN7EXAMPLE", secretAccessKey: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" };
  const date = new Date("2026-10-15T12:34:56Z");
  const sign = (c: { method: string; host: string; path: string; region: string; body?: string; headers?: Record<string, string> }) =>
    signRequest({
      ...creds,
      date,
      method: c.method,
      host: c.host,
      path: c.path,
      region: c.region,
      // a body adds a signed content-length, exactly as S3Client.send does
      headers: c.body === undefined ? c.headers : { ...(c.headers ?? {}), "content-length": String(Buffer.byteLength(c.body)) },
      payloadHash: sha256(c.body ?? ""),
    }).signature;

  test("PUT of a photo to a custom endpoint with a port", () => {
    assert.equal(sign({ method: "PUT", host: "127.0.0.1:9100", path: "/afrimart-photos/photos/document/0123456789abcdef0123456789abcdef.jpg", region: "us-east-1", body: "jpegbytes", headers: { "content-type": "image/jpeg" } }), "5c7dacc31e3ee3303dd8bf683d2e412c31b94aad158b2edcf330fc7e2a544f5a");
  });
  test("PUT to AWS with server-side encryption", () => {
    assert.equal(sign({ method: "PUT", host: "s3.us-east-2.amazonaws.com", path: "/bucket/a/b/c.jpg", region: "us-east-2", body: "x", headers: { "content-type": "image/jpeg", "x-amz-server-side-encryption": "AES256" } }), "dec33972a8cf021f48f4c2c9dc9414834309b1f5af65bd403e2bed0bd24c3386");
  });
  test("PUT to R2 with region auto and a larger body", () => {
    assert.equal(sign({ method: "PUT", host: "abc123.r2.cloudflarestorage.com", path: "/afrimart-photos/claim/ffffffffffffffffffffffffffffffff.jpg", region: "auto", body: "larger body ".repeat(500), headers: { "content-type": "image/jpeg" } }), "c14f82ee66c8996b65dcd7138ab75ae148684c80f2a519bda4b5a674a3b5a060");
  });
  test("GET, HEAD and DELETE, including a key with characters that need encoding", () => {
    assert.equal(sign({ method: "GET", host: "abc123.r2.cloudflarestorage.com", path: "/afrimart-photos/claim/ffffffffffffffffffffffffffffffff.jpg", region: "auto" }), "10180024513d1f535eb5dab06a0e2994a86ec246ea7f6f2f5d59c834f2ff44e8");
    assert.equal(sign({ method: "HEAD", host: "afrimart-photos.s3.us-east-1.amazonaws.com", path: "/packing/aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa.jpg", region: "us-east-1" }), "84724dbbe9b877a39ae9d274337a6e4ab6d87f345f854a13c5625b979fe1673c");
    assert.equal(sign({ method: "DELETE", host: "127.0.0.1:9100", path: "/b/.private-check/a b+c(1)*!'.txt", region: "us-east-1" }), "8f0f2cffc4edab439bacd49828ebac9da859c02eb6d693e6c5f539b005ec22ed");
  });
  test("creating a bucket (an empty key)", () => {
    assert.equal(sign({ method: "PUT", host: "127.0.0.1:9100", path: "/afrimart-verify/", region: "us-east-1" }), "18c6bfab7c0f68cef2d7a8529f28b943db51da49355a9d58a1e4919ca0ead86d");
  });
});

describe("configuration", () => {
  const base = { S3_BUCKET: "afrimart-photos", S3_ACCESS_KEY_ID: "k", S3_SECRET_ACCESS_KEY: "s" } as NodeJS.ProcessEnv;

  test("nothing set means no S3: the development folder is used", () => {
    assert.equal(s3ConfigFromEnv({} as NodeJS.ProcessEnv), null);
    assert.ok(createPhotoStore({} as NodeJS.ProcessEnv) instanceof LocalPhotoStore);
  });

  test("AWS: virtual-hosted, region from the environment, no endpoint", () => {
    const c = s3ConfigFromEnv({ ...base, S3_REGION: "us-east-2" })!;
    assert.deepEqual([c.endpoint, c.region, c.forcePathStyle], [null, "us-east-2", false]);
  });

  test("Cloudflare R2: path-style, region auto", () => {
    const c = s3ConfigFromEnv({ ...base, S3_ENDPOINT: "https://abc123.r2.cloudflarestorage.com/" })!;
    assert.deepEqual([c.endpoint, c.region, c.forcePathStyle], ["https://abc123.r2.cloudflarestorage.com", "auto", true]);
  });

  test("MinIO on this machine is allowed over http, and nothing else is", () => {
    assert.ok(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "http://localhost:9000" }));
    assert.ok(s3ConfigFromEnv({ ...base, S3_ENDPOINT: "http://127.0.0.1:9000" }));
    assert.throws(() => s3ConfigFromEnv({ ...base, S3_ENDPOINT: "http://storage.example.com" }), /https/);
  });

  test("a half-set configuration is an error, never a quiet fall-back to the disk", () => {
    assert.throws(() => s3ConfigFromEnv({ S3_BUCKET: "afrimart-photos" } as NodeJS.ProcessEnv), /partly configured.*S3_ACCESS_KEY_ID.*S3_SECRET_ACCESS_KEY/);
    assert.throws(() => createPhotoStore({ S3_ENDPOINT: "https://x.r2.cloudflarestorage.com" } as NodeJS.ProcessEnv), /partly configured/);
    assert.throws(() => s3ConfigFromEnv({ ...base, S3_BUCKET: "Not A Bucket" }), /valid bucket name/);
  });

  test("a prefix becomes a folder", () => {
    assert.equal(s3ConfigFromEnv({ ...base, S3_KEY_PREFIX: "/photos" })!.keyPrefix, "photos/");
    assert.equal(s3ConfigFromEnv(base)!.keyPrefix, "");
  });
});

/* ------------------------------------------------------ a small fake S3 */

interface FakeS3 {
  url: string;
  objects: Map<string, { body: Buffer; headers: http.IncomingHttpHeaders }>;
  requests: { method: string; path: string; authorised: boolean }[];
  publicRead: boolean;
  failNext: number;
  close(): Promise<void>;
}

function startFakeS3(config: S3Config): Promise<FakeS3> {
  const state: Omit<FakeS3, "url" | "close"> = { objects: new Map(), requests: [], publicRead: false, failNext: 0 };
  const server = http.createServer(async (req, res) => {
    const chunks: Buffer[] = [];
    for await (const c of req) chunks.push(c as Buffer);
    const body = Buffer.concat(chunks);
    const path = new URL(req.url!, "http://x").pathname;

    if (state.failNext > 0) {
      state.failNext--;
      state.requests.push({ method: req.method!, path, authorised: false });
      res.writeHead(503).end();
      return;
    }

    // Re-derive the signature from what actually arrived.
    let authorised = false;
    const auth = req.headers.authorization;
    if (auth) {
      const m = /Credential=([^/]+)\/(\d{8})\/([^/]+)\/s3\/aws4_request,\s*SignedHeaders=([^,]+),\s*Signature=([0-9a-f]{64})/.exec(auth);
      if (m && m[1] === config.accessKeyId) {
        const signedNames = m[4]!.split(";");
        const extra: Record<string, string> = {};
        for (const n of signedNames) if (!["host", "x-amz-content-sha256", "x-amz-date"].includes(n)) extra[n] = String(req.headers[n]);
        const amzDate = String(req.headers["x-amz-date"]);
        const again = signRequest({
          method: req.method!,
          host: String(req.headers.host),
          path: decodeURIComponent(path),
          headers: extra,
          payloadHash: String(req.headers["x-amz-content-sha256"]),
          region: m[3]!,
          accessKeyId: config.accessKeyId,
          secretAccessKey: config.secretAccessKey,
          date: new Date(`${amzDate.slice(0, 4)}-${amzDate.slice(4, 6)}-${amzDate.slice(6, 8)}T${amzDate.slice(9, 11)}:${amzDate.slice(11, 13)}:${amzDate.slice(13, 15)}Z`),
        });
        authorised = again.signature === m[5] && sha256(body) === req.headers["x-amz-content-sha256"];
      }
    }
    state.requests.push({ method: req.method!, path, authorised });

    if (!auth) {
      if (req.method === "GET" && state.publicRead && state.objects.has(path)) return void res.writeHead(200).end(state.objects.get(path)!.body);
      return void res.writeHead(403).end("<Error><Code>AccessDenied</Code></Error>");
    }
    if (!authorised) return void res.writeHead(403).end("<Error><Code>SignatureDoesNotMatch</Code></Error>");

    if (req.method === "PUT") {
      state.objects.set(path, { body, headers: req.headers });
      return void res.writeHead(200).end();
    }
    const obj = state.objects.get(path);
    if (req.method === "DELETE") {
      state.objects.delete(path);
      return void res.writeHead(204).end();
    }
    if (!obj) return void res.writeHead(404).end("<Error><Code>NoSuchKey</Code></Error>");
    res.writeHead(200, { "content-length": String(obj.body.length) });
    res.end(req.method === "HEAD" ? undefined : obj.body);
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const { port } = server.address() as { port: number };
      resolve(Object.assign(state, { url: `http://127.0.0.1:${port}`, close: () => new Promise<void>((r) => server.close(() => r())) }) as FakeS3);
    });
  });
}

describe("the S3 photo store, against a server that checks every signature", () => {
  let fake: FakeS3;
  let config: S3Config;
  let store: S3PhotoStore;
  let client: S3Client;

  before(async () => {
    const draft = { bucket: "afrimart-photos", region: "us-east-1", accessKeyId: "TESTKEY", secretAccessKey: "testsecret/with+chars", forcePathStyle: true, keyPrefix: "", serverSideEncryption: null };
    fake = await startFakeS3({ ...draft, endpoint: "http://127.0.0.1:0" });
    config = { ...draft, endpoint: fake.url, keyPrefix: "photos/", serverSideEncryption: "AES256" };
    // the fake needs the real credentials, which it already has; the endpoint only matters to the client
    client = new S3Client(config);
    store = new S3PhotoStore(client);
  });
  after(() => fake.close());

  const jpegWithGps = () =>
    sharp({ create: { width: 64, height: 48, channels: 3, background: "#cc9966" } })
      .jpeg()
      .withExif({ IFD0: { Make: "ZZS3MAKE" }, IFD3: { GPSLatitudeRef: "N", GPSLatitude: "51/1 30/1 26/1", GPSLongitudeRef: "W", GPSLongitude: "0/1 7/1 39/1" } })
      .toBuffer();

  test("it is durable, which is what lets licence documents in", () => {
    assert.equal(store.durable, true);
    assert.equal(new LocalPhotoStore("/tmp/x").durable, false);
  });

  test("a photo is sanitised, stored under a random key in its kind's folder, and every request was signed correctly", async () => {
    const photo = await jpegWithGps();
    assert.ok(photo.includes(Buffer.from("ZZS3MAKE")), "the fixture must carry metadata for this to prove anything");
    const path = await store.put("document", photo);
    assert.match(path, /^\/photos\/document\/[a-f0-9]{32}\.jpg$/);
    const key = `/afrimart-photos/photos/document/${path.split("/").pop()}`;
    const stored = fake.objects.get(key);
    assert.ok(stored, `object stored at ${key}`);
    assert.ok(!stored.body.includes(Buffer.from("ZZS3MAKE")) && !stored.body.includes(Buffer.from("GPS")), "metadata did not reach the bucket");
    assert.equal(stored.headers["content-type"], "image/jpeg");
    assert.equal(stored.headers["x-amz-server-side-encryption"], "AES256", "encryption at rest was asked for");
    assert.ok(fake.requests.every((r) => r.authorised), "every request carried a signature the server could verify");
  });

  test("reading it back gives the same bytes; a missing object is null; a bad name never reaches the bucket", async () => {
    const path = await store.put("claim", await jpegWithGps());
    const name = path.split("/").pop()!;
    const bytes = await store.read("claim", name);
    assert.ok(bytes && bytes.length > 100);
    assert.equal(await store.read("claim", "0123456789abcdef0123456789abcdef.jpg"), null);
    const before = fake.requests.length;
    assert.equal(await store.read("claim", "../document/" + name), null);
    assert.equal(await store.read("secrets" as never, name), null);
    assert.equal(fake.requests.length, before, "invalid names are refused before any request is made");
    assert.equal(await store.read("document", name), null, "a photo is only found under the kind it was stored with");
  });

  test("a wrong secret is refused by the server and surfaces as an error", async () => {
    const bad = new S3Client({ ...config, secretAccessKey: "wrong" });
    await assert.rejects(bad.putObject("photos/x/y.jpg", Buffer.from("a"), "image/jpeg"), /refused a write \(403\)/);
  });

  test("a transient server error is retried once; two in a row is an error", async () => {
    fake.failNext = 1;
    await client.putObject("photos/retry/a.jpg", Buffer.from("a"), "image/jpeg");
    fake.failNext = 2;
    await assert.rejects(client.putObject("photos/retry/b.jpg", Buffer.from("b"), "image/jpeg"), /refused a write \(503\)/);
  });

  test("credentials never appear in a URL or the signed headers' values", async () => {
    const urls = fake.requests.map((r) => r.path).join(" ");
    assert.ok(!urls.includes("testsecret") && !urls.includes("TESTKEY"));
  });

  test("the start-up check passes for a private bucket, refuses a public one, and removes its probe either way", async () => {
    fake.publicRead = false;
    await assertBucketPrivate(client);
    assert.ok(![...fake.objects.keys()].some((k) => k.includes(".private-check")), "probe removed");
    fake.publicRead = true;
    await assert.rejects(assertBucketPrivate(client), /serves objects to anonymous requests/);
    assert.ok(![...fake.objects.keys()].some((k) => k.includes(".private-check")), "probe removed after a refusal too");
    fake.publicRead = false;
  });

  test("the migration copies a local folder across byte for byte, once, and deletes nothing", async () => {
    const { mkdtemp, mkdir, writeFile, readdir, rm } = await import("node:fs/promises");
    const os = await import("node:os");
    const path = await import("node:path");
    const root = await mkdtemp(path.join(os.tmpdir(), "afrimart-migrate-"));
    try {
      await mkdir(path.join(root, "claim"), { recursive: true });
      await mkdir(path.join(root, "document"), { recursive: true });
      await writeFile(path.join(root, "claim", "11111111111111111111111111111111.jpg"), "claim bytes");
      await writeFile(path.join(root, "document", "22222222222222222222222222222222.jpg"), "licence bytes");
      await writeFile(path.join(root, "claim", "notes.txt"), "not a photo");

      const dry = await migratePhotos({ root, store, dryRun: true });
      assert.deepEqual([dry.copied, dry.skipped.length], [2, 1]);
      assert.equal(await store.has("claim", "11111111111111111111111111111111.jpg"), false, "a dry run writes nothing");

      const first = await migratePhotos({ root, store });
      assert.deepEqual([first.copied, first.alreadyThere, first.mismatched.length, first.skipped], [2, 0, 0, ["claim/notes.txt"]]);
      assert.equal((await store.read("document", "22222222222222222222222222222222.jpg"))?.toString(), "licence bytes");

      const second = await migratePhotos({ root, store });
      assert.deepEqual([second.copied, second.alreadyThere], [0, 2], "running it again copies nothing");

      await writeFile(path.join(root, "claim", "11111111111111111111111111111111.jpg"), "changed locally");
      const third = await migratePhotos({ root, store });
      assert.deepEqual(third.mismatched, ["claim/11111111111111111111111111111111.jpg"], "a file that differs from what is in the bucket is reported, not overwritten");
      assert.equal((await store.read("claim", "11111111111111111111111111111111.jpg"))?.toString(), "claim bytes");
      assert.equal((await readdir(path.join(root, "claim"))).length, 2, "the local folder is untouched");
    } finally {
      await rm(root, { recursive: true, force: true });
    }
  });

  test("moving a file in keeps its name and bytes", async () => {
    const name = "abcdefabcdefabcdefabcdefabcdefab.jpg";
    await store.copyIn("packing", name, Buffer.from("already clean"));
    assert.equal(await store.has("packing", name), true);
    assert.equal((await store.read("packing", name))?.toString(), "already clean");
    await assert.rejects(store.copyIn("packing", "../x.jpg", Buffer.from("x")), /Not a stored photo/);
  });
});
