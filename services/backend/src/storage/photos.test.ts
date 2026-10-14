import { test, describe, after } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import sharp from "sharp";

import { LocalPhotoStore, MAX_EDGE_PX, MAX_UPLOAD_BYTES, PhotoRejected, decodeUpload, sanitizePhoto } from "./photos.js";

/**
 * QC-2 / QC-3 — photo evidence.
 *
 * The EXIF tests share one shape on purpose: build an image that really carries
 * a camera make, a free-text description, a timestamp and a GPS position, assert
 * that the INPUT contains all of it, then assert the OUTPUT contains none of it.
 * Without the first step a strip test can pass because the fixture never had
 * metadata to begin with, which proves nothing.
 */

const MARK = {
  make: "ZZCAMERAMAKE",
  description: "ZZHOMEADDRESS-12-ACACIA-ROAD",
  software: "ZZEDITOR",
  artist: "ZZPHOTOGRAPHER",
};

const exif = {
  IFD0: { Make: MARK.make, ImageDescription: MARK.description, Software: MARK.software, Artist: MARK.artist },
  IFD2: { DateTimeOriginal: "2026:10:14 13:41:09" },
  // GPS: 51°30'26"N 0°7'39"W — somewhere a real person lives.
  IFD3: {
    GPSLatitudeRef: "N",
    GPSLatitude: "51/1 30/1 26/1",
    GPSLongitudeRef: "W",
    GPSLongitude: "0/1 7/1 39/1",
  },
};

async function base(width = 64, height = 48) {
  return sharp({ create: { width, height, channels: 3, background: { r: 200, g: 160, b: 110 } } });
}

const FORMATS = {
  jpeg: async () => (await base()).jpeg().withExif(exif).toBuffer(),
  png: async () => (await base()).png().withExif(exif).toBuffer(),
  webp: async () => (await base()).webp().withExif(exif).toBuffer(),
};

const contains = (buf: Buffer, needle: string) => buf.includes(Buffer.from(needle, "latin1"));

describe("uploads are stripped of EXIF metadata, including GPS location, before they are stored", () => {
  for (const [format, make] of Object.entries(FORMATS)) {
    test(`${format}: camera, description, time and GPS are all gone`, async () => {
      const input = await make();

      // Precondition: the fixture really carries what we claim to remove.
      assert.ok(contains(input, MARK.make), `the ${format} fixture lost its camera make; the test would prove nothing`);
      assert.ok(contains(input, MARK.description), "fixture lost its description");
      assert.ok((await sharp(input).metadata()).exif, "fixture has no EXIF block");
      assert.ok(contains(input, "GPS") || (await sharp(input).metadata()).exif!.length > 40, "fixture carries no GPS data");

      const out = await sanitizePhoto(input);

      for (const needle of Object.values(MARK)) assert.ok(!contains(out, needle), `${needle} survived`);
      assert.ok(!contains(out, "Exif\0\0"), "an EXIF segment survived");
      assert.ok(!contains(out, "GPS"), "a GPS tag survived");
      assert.ok(!contains(out, "http://ns.adobe.com/xap"), "an XMP packet survived");
      const meta = await sharp(out).metadata();
      assert.equal(meta.exif, undefined, "sharp still reads an EXIF block");
      assert.equal(meta.xmp, undefined);
      assert.equal(meta.iptc, undefined);
      assert.equal(meta.icc, undefined);
      assert.equal(meta.format, "jpeg", "everything is stored as JPEG");
    });
  }

  test("the GPS coordinates cannot be recovered even as raw numbers", async () => {
    const out = await sanitizePhoto(await FORMATS.jpeg());
    // The EXIF rational encodings of 51/30/26 N and 0/7/39 W, as little- and big-endian bytes.
    const lat = Buffer.from([51, 0, 0, 0, 1, 0, 0, 0, 30, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 1, 0, 0, 0]);
    const latBE = Buffer.from([0, 0, 0, 51, 0, 0, 0, 1, 0, 0, 0, 30, 0, 0, 0, 1, 0, 0, 0, 26, 0, 0, 0, 1]);
    assert.ok(!out.includes(lat) && !out.includes(latBE));
  });

  test("a JPEG with an XMP packet and a comment loses those too", async () => {
    // Splice an APP1 XMP segment and a COM segment straight after the SOI marker.
    const jpeg = await (await base()).jpeg().toBuffer();
    const xmp = Buffer.from("http://ns.adobe.com/xap/1.0/\0<x:xmpmeta>ZZXMPSECRET</x:xmpmeta>", "latin1");
    const comment = Buffer.from("ZZCOMMENTSECRET", "latin1");
    const seg = (marker: number, body: Buffer) => Buffer.concat([Buffer.from([0xff, marker, (body.length + 2) >> 8, (body.length + 2) & 0xff]), body]);
    const tainted = Buffer.concat([jpeg.subarray(0, 2), seg(0xe1, xmp), seg(0xfe, comment), jpeg.subarray(2)]);
    assert.ok(contains(tainted, "ZZXMPSECRET") && contains(tainted, "ZZCOMMENTSECRET"), "fixture is not tainted");

    const out = await sanitizePhoto(tainted);
    assert.ok(!contains(out, "ZZXMPSECRET") && !contains(out, "ZZCOMMENTSECRET"));
  });

  test("a payload appended after the image is not carried through", async () => {
    const jpeg = await (await base()).jpeg().toBuffer();
    const tainted = Buffer.concat([jpeg, Buffer.from("ZZTRAILINGPAYLOAD<script>alert(1)</script>", "latin1")]);
    assert.ok(contains(tainted, "ZZTRAILINGPAYLOAD"));
    assert.ok(!contains(await sanitizePhoto(tainted), "ZZTRAILINGPAYLOAD"));
  });
});

describe("sanitising keeps the picture right", () => {
  test("the camera's orientation is applied to the pixels before the tag is dropped", async () => {
    // A 40x20 landscape frame the camera marked as 'rotate 90 degrees to display'.
    const input = await (await base(40, 20)).jpeg().withMetadata({ orientation: 6 }).toBuffer();
    assert.equal((await sharp(input).metadata()).orientation, 6, "fixture has no orientation tag");

    const out = await sanitizePhoto(input);
    const meta = await sharp(out).metadata();
    assert.deepEqual([meta.width, meta.height], [20, 40], "a portrait photo came out sideways");
    assert.equal(meta.orientation, undefined);
  });

  test("a large photo is bounded to the longest-edge limit", async () => {
    const input = await (await base(4000, 3000)).jpeg().toBuffer();
    const meta = await sharp(await sanitizePhoto(input)).metadata();
    assert.equal(Math.max(meta.width!, meta.height!), MAX_EDGE_PX);
  });

  test("a small photo is not blown up", async () => {
    const meta = await sharp(await sanitizePhoto(await (await base(64, 48)).jpeg().toBuffer())).metadata();
    assert.deepEqual([meta.width, meta.height], [64, 48]);
  });
});

describe("only real photos are accepted", () => {
  test("text, HTML, SVG and scripts are refused whatever they claim to be", async () => {
    for (const body of [
      "plain text",
      "<html><script>alert(1)</script></html>",
      '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
      "GIF89a-not-really",
    ]) {
      await assert.rejects(sanitizePhoto(Buffer.from(body)), PhotoRejected, body.slice(0, 20));
    }
  });

  test("a file with a JPEG header and garbage after it is refused, not stored", async () => {
    await assert.rejects(sanitizePhoto(Buffer.concat([Buffer.from([0xff, 0xd8, 0xff, 0xe0]), Buffer.alloc(200, 7)])), PhotoRejected);
  });

  test("upload decoding: base64, data URLs, empties, junk and oversize", () => {
    const bytes = Buffer.from("hello");
    assert.deepEqual(decodeUpload(bytes.toString("base64")), bytes);
    assert.deepEqual(decodeUpload(`data:image/jpeg;base64,${bytes.toString("base64")}`), bytes);
    assert.throws(() => decodeUpload(""), PhotoRejected);
    assert.throws(() => decodeUpload("not base64 !!!"), PhotoRejected);
    assert.throws(() => decodeUpload(Buffer.alloc(MAX_UPLOAD_BYTES + 1).toString("base64")), PhotoRejected);
  });
});

describe("the store", () => {
  const dirs: string[] = [];
  after(async () => {
    for (const d of dirs) await rm(d, { recursive: true, force: true });
  });
  const fresh = async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "afrimart-photos-"));
    dirs.push(dir);
    return { dir, store: new LocalPhotoStore(dir) };
  };

  test("what lands on disk is the sanitised photo, never the upload as received", async () => {
    const { dir, store } = await fresh();
    const input = await FORMATS.jpeg();
    assert.ok(contains(input, MARK.make));

    const url = await store.put("packing", input);
    assert.match(url, /^\/photos\/packing\/[a-f0-9]{32}\.jpg$/);

    const files = await readdir(path.join(dir, "packing"));
    assert.equal(files.length, 1);
    const stored = await readFile(path.join(dir, "packing", files[0]!));
    for (const needle of Object.values(MARK)) assert.ok(!contains(stored, needle), `${needle} reached the disk`);
    assert.equal((await sharp(stored).metadata()).exif, undefined);
    assert.deepEqual(await store.read("packing", files[0]!), stored);
  });

  test("claim photos are stored the same way", async () => {
    const { dir, store } = await fresh();
    const url = await store.put("claim", await FORMATS.png());
    assert.match(url, /^\/photos\/claim\//);
    const [name] = await readdir(path.join(dir, "claim"));
    assert.ok(!contains(await readFile(path.join(dir, "claim", name!)), MARK.make));
  });

  test("a refused upload leaves nothing behind", async () => {
    const { dir, store } = await fresh();
    await assert.rejects(store.put("packing", Buffer.from("<script>")), PhotoRejected);
    await assert.rejects(readdir(path.join(dir, "packing")), /ENOENT/);
  });

  test("names are unguessable and different every time", async () => {
    const { store } = await fresh();
    const a = await store.put("packing", await FORMATS.jpeg());
    const b = await store.put("packing", await FORMATS.jpeg());
    assert.notEqual(a, b);
  });

  test("reads cannot escape the store or reach an unknown kind", async () => {
    const { store } = await fresh();
    await store.put("packing", await FORMATS.jpeg());
    for (const name of ["../claim/x.jpg", "..\\..\\etc\\passwd", "a.jpg", "A".repeat(32) + ".jpg", "../../package.json", ""]) {
      assert.equal(await store.read("packing", name), null, name);
    }
    assert.equal(await store.read("../packing" as never, "0".repeat(32) + ".jpg"), null);
  });
});

describe("there is no way to store bytes without sanitising them", () => {
  test("photos.ts has exactly one write, and it follows sanitizePhoto inside put", async () => {
    const src = await readFile(new URL("./photos.ts", import.meta.url), "utf8");
    assert.equal((src.match(/\bwriteFile\(/g) ?? []).length, 1);
    const put = src.slice(src.indexOf("async put("), src.indexOf("async read("));
    assert.ok(put.indexOf("await sanitizePhoto(") > -1 && put.indexOf("await sanitizePhoto(") < put.indexOf("writeFile("));
  });

  test("nothing else in the backend writes into the upload area or sets a photo url from client input", async () => {
    const { readdir: ls, readFile: rf } = await import("node:fs/promises");
    const offenders: string[] = [];
    async function walk(dir: URL) {
      for (const e of await ls(dir, { withFileTypes: true })) {
        const child = new URL(`${e.name}${e.isDirectory() ? "/" : ""}`, dir);
        if (e.isDirectory()) await walk(child);
        else if (e.name.endsWith(".ts") && !e.name.endsWith(".test.ts") && !child.pathname.endsWith("/storage/photos.ts")) {
          const text = await rf(child, "utf8");
          if (/\.uploads|UPLOAD_DIR/.test(text)) offenders.push(child.pathname);
        }
      }
    }
    await walk(new URL("../", import.meta.url));
    assert.deepEqual(offenders, []);
  });

  test("every photo url the API stores comes from the photo store", async () => {
    const merchant = await readFile(new URL("../routers/merchant.ts", import.meta.url), "utf8");
    assert.match(merchant, /photoStore\.put\("packing", decodeUpload\(input\.image\)\)/);
    assert.ok(!/packingPhotoUrl:\s*input\./.test(merchant), "a client-supplied url is stored as a packing photo");
  });

  test("the server serves photos as images only, with nosniff", async () => {
    const server = await readFile(new URL("./route.ts", import.meta.url), "utf8");
    assert.match(server, /x-content-type-options", "nosniff"/);
    assert.match(server, /content-type", "image\/jpeg"/);
    assert.match(server, /photoStore\.read\(/);
  });
});

describe("QC-2 a shipment cannot leave without its packing photo", () => {
  test("markShipped refuses when there is no photo on record, and checks ownership first", async () => {
    const merchant = await readFile(new URL("../routers/merchant.ts", import.meta.url), "utf8");
    const start = merchant.indexOf("markShipped: merchantProcedure");
    const body = merchant.slice(start, merchant.indexOf("\n  }),", start));
    assert.ok(body.indexOf("storeId: ctx.storeId") < body.indexOf("packingPhotoUrl"), "ownership is not checked first");
    assert.match(body, /if \(!shipment\.packingPhotoUrl\)/);
  });

  test("the photo is taken after the order is accepted and before it is handed over", async () => {
    const merchant = await readFile(new URL("../routers/merchant.ts", import.meta.url), "utf8");
    const start = merchant.indexOf("packingPhoto: merchantProcedure");
    const body = merchant.slice(start, merchant.indexOf("\n  }),", start));
    assert.match(body, /storeId: ctx\.storeId/);
    assert.match(body, /shipment\.status === "pending"/);
    assert.match(body, /shipment\.status !== "label_created"/);
    assert.match(body, /packingPhotoAt: new Date\(\)/);
  });

  test("the merchant app only enables the action once the photo exists", async () => {
    const page = await readFile(new URL("../../../../apps/merchant/app/page.tsx", import.meta.url), "utf8");
    assert.match(page, /readyToShip = allPacked && open\.photoUrl !== null/);
    assert.match(page, /disabled=\{!readyToShip/);
  });
});
