import { randomBytes } from "node:crypto";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import sharp from "sharp";

/**
 * Photo evidence: the seller's packing photo (QC-2) and the buyer's claim
 * photos (QC-3).
 *
 * Two rules shape this file.
 *
 * 1. Nothing is stored as received. Every upload is decoded and re-encoded, and
 *    that is what removes its metadata. A phone photo carries EXIF: the exact
 *    GPS position it was taken at (a seller's home, a buyer's front door), the
 *    device, the time. Neither a seller nor a buyer chose to publish any of that
 *    by attaching a photo, and these images are shown to staff and, for claims,
 *    to the other party. Re-encoding rather than deleting known tags means an
 *    unfamiliar tag, an XMP packet or a trailing payload does not survive either.
 *    `PhotoStore.put` is the only way in and it sanitises first; there is no
 *    method that stores bytes as they arrived.
 *
 * 2. Storage is a port. `LocalPhotoStore` writes to disk for development;
 *    `S3PhotoStore` (s3.ts) keeps photos in any S3-compatible bucket and is what
 *    runs everywhere else. Which one is chosen from the environment lives in
 *    store.ts. Photos are private: nothing here is served by its path. Access is
 *    decided by the procedure that returns a photo and expressed as a
 *    short-lived signed link (access.ts), which the picture route requires.
 *
 *    The file name is 128 random bits and that is only defence in depth. A disk
 *    on a single server is not where licence documents belong, so a store says
 *    whether it is `durable`, and documents are refused where it is not (see
 *    `assertCanKeepDocuments` in store.ts).
 */

export const PHOTO_KINDS = ["packing", "claim", "document", "shelf", "product"] as const;
export type PhotoKind = typeof PHOTO_KINDS[number];

/** Decoded size ceiling. Clients downscale before upload, so this is generous. */
export const MAX_UPLOAD_BYTES = 8 * 1024 * 1024;
/** Longest edge kept. Plenty to judge a box or a bruise; keeps storage small. */
export const MAX_EDGE_PX = 2000;
/** Refuse decompression bombs: a tiny file that expands to a huge bitmap. */
const MAX_INPUT_PIXELS = 64_000_000;

export class PhotoRejected extends Error {}

/** Accepts a bare base64 string or a `data:image/...;base64,` URL. */
export function decodeUpload(data: string): Buffer {
  const base64 = data.startsWith("data:") ? data.slice(data.indexOf(",") + 1) : data;
  if (!/^[A-Za-z0-9+/=\s]+$/.test(base64) || base64.length === 0) {
    throw new PhotoRejected("That doesn't look like a photo. Please take it again.");
  }
  const bytes = Buffer.from(base64, "base64");
  if (bytes.length === 0) throw new PhotoRejected("That photo came through empty. Please take it again.");
  if (bytes.length > MAX_UPLOAD_BYTES) throw new PhotoRejected("That photo is too large. Please take it again.");
  return bytes;
}

/** Real image bytes only: judged by content, never by the name or type the client claimed. */
function looksLikeImage(b: Buffer): boolean {
  const jpeg = b.length > 3 && b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  const png = b.length > 8 && b.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]));
  const webp = b.length > 12 && b.subarray(0, 4).toString("latin1") === "RIFF" && b.subarray(8, 12).toString("latin1") === "WEBP";
  return jpeg || png || webp;
}

/**
 * Decode, apply the orientation the camera recorded, bound the size, and
 * re-encode as JPEG with no metadata.
 *
 * `.rotate()` with no argument bakes the EXIF orientation into the pixels
 * before the tag is thrown away; without it every portrait photo taken on a
 * phone would come out sideways once the orientation tag was gone. sharp
 * writes no metadata unless asked to, which is the whole mechanism — so the
 * result is checked rather than trusted: a failure here refuses to store.
 */
export async function sanitizePhoto(input: Buffer, maxEdge = MAX_EDGE_PX): Promise<Buffer> {
  if (!looksLikeImage(input)) {
    throw new PhotoRejected("That doesn't look like a photo. Please take it again.");
  }
  let out: Buffer;
  try {
    out = await sharp(input, { limitInputPixels: MAX_INPUT_PIXELS, failOn: "error" })
      .rotate()
      .resize({ width: maxEdge, height: maxEdge, fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 85 })
      .toBuffer();
  } catch {
    throw new PhotoRejected("We couldn't read that photo. Please take it again.");
  }
  await assertNoMetadata(out);
  return out;
}

/** Belt and braces: the output must carry no EXIF, XMP, IPTC or ICC block at all. */
async function assertNoMetadata(jpeg: Buffer): Promise<void> {
  const meta = await sharp(jpeg).metadata();
  const leaked = [meta.exif && "EXIF", meta.xmp && "XMP", meta.iptc && "IPTC", meta.icc && "ICC"].filter(Boolean);
  // JPEG APP segments, scanned directly: an APP1 "Exif" or "http://ns.adobe.com/xap" marker means a block got through.
  const raw = jpeg.toString("latin1");
  if (raw.includes("Exif\0\0")) leaked.push("EXIF segment");
  if (raw.includes("http://ns.adobe.com/xap")) leaked.push("XMP packet");
  if (leaked.length) throw new Error(`Refusing to store a photo that still carries metadata: ${leaked.join(", ")}`);
}

export interface PhotoStore {
  /**
   * True for storage that survives a redeploy and is private by construction
   * (an object store with no public access). A directory on the web server is
   * neither, so the local store is not.
   */
  readonly durable: boolean;
  /** Sanitises, stores, and returns the path the photo is served from. */
  put(kind: PhotoKind, upload: Buffer, name?: string): Promise<string>;
  removeShelfFrame(name: string): Promise<void>;
  read(kind: PhotoKind, name: string): Promise<Buffer | null>;
}

/** The only shape a stored photo's file name takes: 128 random bits and ".jpg". */
export const PHOTO_NAME = /^[a-f0-9]{32}\.jpg$/;

/** The development store: a folder on this machine. Never durable, never for production. */
export class LocalPhotoStore implements PhotoStore {
  readonly durable = false;
  constructor(private readonly root: string) {}

  async removeShelfFrame(name: string): Promise<void> {
    if (!PHOTO_NAME.test(name)) throw new Error("Invalid shelf photo name");
    await rm(path.join(this.root, "shelf", name), { force: true });
  }

  async put(kind: PhotoKind, upload: Buffer, name = `${randomBytes(16).toString("hex")}.jpg`): Promise<string> {
    if (!PHOTO_NAME.test(name)) throw new Error("Invalid photo name");
    const clean = await sanitizePhoto(upload, kind === "product" ? 640 : kind === "shelf" ? 1600 : MAX_EDGE_PX);
    const dir = path.join(this.root, kind);
    await mkdir(dir, { recursive: true });
    const target = path.join(dir, name);
    // Retakes replace a product photo at the same path. Publish the complete JPEG atomically.
    const staged = kind === "product" ? path.join(dir, randomBytes(16).toString("hex") + ".tmp") : null;
    try {
      await writeFile(staged ?? target, clean);
      if (staged) await rename(staged, target);
    } finally {
      if (staged) await rm(staged, { force: true });
    }
    return `/photos/${kind}/${name}`;
  }

  async read(kind: PhotoKind, name: string): Promise<Buffer | null> {
    // Both parts are validated against fixed shapes, so no input can name a path
    // outside the store.
    if (!PHOTO_KINDS.includes(kind) || !PHOTO_NAME.test(name)) return null;
    try {
      return await readFile(path.join(this.root, kind, name));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
      throw error;
    }
  }
}

/** Where the development store keeps files unless UPLOAD_DIR says otherwise. */
export const DEFAULT_PHOTO_ROOT = fileURLToPath(new URL("../../.uploads/", import.meta.url));
