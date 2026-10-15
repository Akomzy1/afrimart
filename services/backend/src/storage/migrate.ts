import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { PHOTO_KINDS, PHOTO_NAME } from "./photos.js";
import type { S3PhotoStore } from "./s3.js";

/**
 * Move photos from the development folder into the bucket.
 *
 * Each file keeps its name and its folder (`kind/name.jpg`), and the database
 * stores `/photos/kind/name.jpg`, so no row changes. Files in the folder were
 * all sanitised when they were stored, so they are copied byte for byte. Every
 * copy is read back and compared before it counts. Nothing is deleted: the
 * local folder is left for a person to remove once the counts look right.
 * Running it twice copies nothing the second time.
 */

export interface MigrationResult {
  copied: number;
  alreadyThere: number;
  mismatched: string[];
  skipped: string[];
}

const hash = (b: Buffer) => createHash("sha256").update(b).digest("hex");

export async function migratePhotos(opts: { root: string; store: S3PhotoStore; dryRun?: boolean }): Promise<MigrationResult> {
  const result: MigrationResult = { copied: 0, alreadyThere: 0, mismatched: [], skipped: [] };

  for (const kind of PHOTO_KINDS) {
    const dir = path.join(opts.root, kind);
    let names: string[];
    try {
      names = await readdir(dir);
    } catch {
      continue; // no folder for this kind
    }
    for (const name of names.sort()) {
      if (!PHOTO_NAME.test(name)) {
        result.skipped.push(`${kind}/${name}`);
        continue;
      }
      const bytes = await readFile(path.join(dir, name));

      if (await opts.store.has(kind, name)) {
        // Already there: it must be the same file, or something is wrong.
        const there = await opts.store.read(kind, name);
        if (!there || hash(there) !== hash(bytes)) result.mismatched.push(`${kind}/${name}`);
        else result.alreadyThere++;
        continue;
      }
      if (opts.dryRun) {
        result.copied++;
        continue;
      }
      await opts.store.copyIn(kind, name, bytes);
      const back = await opts.store.read(kind, name);
      if (!back || hash(back) !== hash(bytes)) result.mismatched.push(`${kind}/${name}`);
      else result.copied++;
    }
  }
  return result;
}
