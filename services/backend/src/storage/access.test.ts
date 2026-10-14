import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { parsePhotoPath, photoLinkIsValid, signedPhotoUrl } from "./access.js";
import { LocalPhotoStore, assertCanKeepDocuments, PhotoRejected } from "./photos.js";

const NAME = "0123456789abcdef0123456789abcdef.jpg";
const OTHER = "fedcba9876543210fedcba9876543210.jpg";
const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");

/** Pull `exp` and `sig` back out of a signed link. */
function parts(link: string) {
  const u = new URL(link, "http://x");
  const [, , kind, name] = u.pathname.split("/");
  return { kind: kind!, name: name!, exp: u.searchParams.get("exp") ?? undefined, sig: u.searchParams.get("sig") ?? undefined };
}

describe("signed photo links", () => {
  test("a freshly signed link is valid for exactly that file", () => {
    const link = signedPhotoUrl(`/photos/claim/${NAME}`)!;
    const p = parts(link);
    assert.equal(p.kind, "claim");
    assert.equal(p.name, NAME);
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, p.sig), true);
  });

  test("it is only good for a short time", () => {
    const now = Date.now();
    const link = signedPhotoUrl(`/photos/document/${NAME}`, { ttlSeconds: 300, now })!;
    const p = parts(link);
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, p.sig, now + 299_000), true);
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, p.sig, now + 301_000), false, "expired");
  });

  test("the lifetime is minutes, not days", async () => {
    const config = await src("../config.js".replace(".js", ".ts"));
    const m = /PHOTO_URL_TTL_SECONDS = Number\(process\.env\.PHOTO_URL_TTL_SECONDS \?\? (\d+)\)/.exec(config);
    assert.ok(m && Number(m[1]) <= 600, "the default link lifetime should be ten minutes at most");
  });

  test("a link for one file does not open another, or another kind of photo", () => {
    const p = parts(signedPhotoUrl(`/photos/claim/${NAME}`)!);
    assert.equal(photoLinkIsValid(p.kind, OTHER, p.exp, p.sig), false, "a different file");
    assert.equal(photoLinkIsValid("document", p.name, p.exp, p.sig), false, "a different kind");
    assert.equal(photoLinkIsValid("packing", p.name, p.exp, p.sig), false, "a different kind");
  });

  test("changing the expiry or the signature breaks it", () => {
    const p = parts(signedPhotoUrl(`/photos/claim/${NAME}`)!);
    assert.equal(photoLinkIsValid(p.kind, p.name, String(Number(p.exp) + 86_400), p.sig), false, "an extended expiry");
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, p.sig!.replace(/^./, (c) => (c === "a" ? "b" : "a"))), false, "a flipped digit");
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, undefined), false, "no signature");
    assert.equal(photoLinkIsValid(p.kind, p.name, undefined, p.sig), false, "no expiry");
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, "0".repeat(64)), false, "a made-up signature");
    assert.equal(photoLinkIsValid(p.kind, p.name, p.exp, "zz"), false, "a malformed signature");
  });

  test("a path that is not a stored photo is not signed, and nothing is signed for null", () => {
    assert.equal(signedPhotoUrl(null), null);
    assert.equal(signedPhotoUrl(undefined), null);
    assert.equal(signedPhotoUrl("/photos/claim/../../etc/passwd"), null);
    assert.equal(signedPhotoUrl(`/photos/other/${NAME}`), null);
    assert.equal(signedPhotoUrl("https://elsewhere.example/photo.jpg"), null);
    assert.equal(parsePhotoPath(`/photos/packing/${NAME}`)?.kind, "packing");
  });

  test("an unknown kind or a path-shaped name never validates, whatever the signature", () => {
    assert.equal(photoLinkIsValid("secrets", NAME, "9999999999", "0".repeat(64)), false);
    assert.equal(photoLinkIsValid("claim", "../x.jpg", "9999999999", "0".repeat(64)), false);
  });
});

describe("the picture route and where photos are kept", () => {
  test("the route serves nothing without a valid signature, and never caches", async () => {
    const server = await src("../server.ts");
    const route = await src("./route.ts");
    assert.match(route, /photoLinkIsValid\(kind, name, req\.query\.exp, req\.query\.sig\)/);
    assert.ok(!/immutable|max-age=3/.test(route), "photos must not be cached for a year");
    assert.match(route, /private, no-store/);
    assert.match(server, /registerPhotoRoute\(server\)/);
    assert.match(server, /assertPhotoSigningConfigured\(\)/);
  });

  test("no procedure returns a raw stored photo path", async () => {
    for (const f of ["../routers/merchant.ts", "../routers/admin.ts", "../routers/orders.ts", "../routers/claims.ts"]) {
      const text = (await src(f)).replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
      assert.ok(!/(?:packingPhotoUrl|photoUrl):\s*[a-z.?]*(?:packingPhotoUrl|photoUrl)\s*[,}\n]/.test(text.replace(/signedPhotoUrl\([^)]*\)/g, "")), `${f} returns a stored photo path as it is`);
    }
  });

  test("licence documents are refused where storage is not durable and private, and allowed on a development machine", async () => {
    const dir = await import("node:os").then((os) => os.tmpdir());
    const local = new LocalPhotoStore(dir);
    const dev = { NODE_ENV: "development", DATABASE_URL: "postgresql://u:p@localhost:5432/afrimart" } as NodeJS.ProcessEnv;
    const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db.example.com:5432/afrimart" } as NodeJS.ProcessEnv;
    assert.doesNotThrow(() => assertCanKeepDocuments(local, dev));
    assert.throws(() => assertCanKeepDocuments(local, prod), PhotoRejected);
    const durable = Object.assign(Object.create(local), { durable: true });
    assert.doesNotThrow(() => assertCanKeepDocuments(durable, prod), "an object store that is durable and private is accepted");
  });

  test("the merchant router checks before it keeps a document", async () => {
    const text = await src("../routers/merchant.ts");
    const fn = text.slice(text.indexOf("async function storeDocument"), text.indexOf("export const merchantRouter"));
    assert.ok(fn.indexOf("assertCanKeepDocuments()") > -1 && fn.indexOf("assertCanKeepDocuments()") < fn.indexOf("photoStore.put"));
  });
});
