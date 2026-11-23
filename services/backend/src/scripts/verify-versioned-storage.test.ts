import { test } from "node:test";
import assert from "node:assert/strict";
import { S3Client } from "../storage/s3.js";
import { verifyVersionedStorage } from "./verify-versioned-storage.js";

function bucket(options: { public?: boolean; hideOlder?: boolean; versioned?: boolean; ignoreReadVersion?: boolean } = {}) {
  const versions = new Map<string, Uint8Array>();
  let current: string | undefined;
  let issued = 0;
  const config = { bucket: "fixture", region: "us-east-1", endpoint: "http://localhost:9999", accessKeyId: "test",
    secretAccessKey: "test", keyPrefix: "private/", forcePathStyle: true, serverSideEncryption: null };
  const client = new S3Client(config, async (input, init) => {
    const url = new URL(String(input));
    assert.match(url.pathname, /^\/fixture\/private\/shelf\/[a-f0-9]{32}\.jpg$/);
    const id = url.searchParams.get("versionId") ?? current;
    switch (init?.method) {
      case "PUT":
        current = String(++issued) + "+/=";
        versions.set(current, init.body as Uint8Array);
        return new Response(null, { headers: options.versioned === false ? {} : { "x-amz-version-id": current } });
      case "HEAD":
        return current ? new Response(null, { headers: { "x-amz-version-id": current } }) : new Response(null, { status: 404 });
      case "DELETE":
        if (id) versions.delete(id);
        current = options.hideOlder ? undefined : [...versions.keys()].at(-1);
        return new Response(null, { status: 204 });
      case "GET":
        if (!new Headers(init.headers).has("authorization") && !options.public) return new Response(null, { status: 403 });
        const requested = options.ignoreReadVersion ? current : id;
        return requested && versions.has(requested) ? new Response(Buffer.from(versions.get(requested)!)) : new Response(null, { status: 404 });
      default: throw Error("Unexpected request");
    }
  });
  return { client, versions };
}

test("the staging check confirms both versions were deleted", async () => {
  const { client, versions } = bucket();
  await verifyVersionedStorage(client);
  assert.equal(versions.size, 0);
});

test("the two version IDs must identify different photo bytes", async () => {
  const { client, versions } = bucket({ ignoreReadVersion: true });
  await assert.rejects(verifyVersionedStorage(client), /original bytes/);
  assert.equal(versions.size, 0);
});

test("a missing current object cannot hide an older readable version", async () => {
  const { client, versions } = bucket({ hideOlder: true });
  await assert.rejects(verifyVersionedStorage(client), /prior shelf version is still readable/);
  assert.equal(versions.size, 0);
});

test("public or unversioned buckets fail verification and the fixture is cleaned up", async () => {
  for (const options of [{public:true}, {versioned:false}]) {
    const { client, versions } = bucket(options);
    await assert.rejects(verifyVersionedStorage(client), options.public ? /Anonymous access/ : /issue a version ID/);
    assert.equal(versions.size, 0);
  }
});
