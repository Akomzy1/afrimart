import { createHash } from "node:crypto";
import { readFile, realpath, stat } from "node:fs/promises";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { z } from "zod";
import { matchDelivery } from "../../services/backend/src/catalogue/delivery.js";
import { readDelivery } from "../../services/backend/src/catalogue/providers.js";
import { prisma } from "../../services/backend/src/db.js";
import { MAX_UPLOAD_BYTES, sanitizePhoto } from "../../services/backend/src/storage/photos.js";

const label = z.object({ listingId: z.string().min(1), units: z.number().int().positive().max(100000).nullable() });
const manifest = z.object({ storeId: z.string().min(1), photos: z.array(z.object({
  file: z.string().min(1), expected: z.array(label).max(50),
})).min(1) });
type Expected = z.infer<typeof label>;
type Suggestion = Pick<ReturnType<typeof matchDelivery>[number], "listingId" | "units">;
type Listing = Parameters<typeof matchDelivery>[1][number];
type Read = (photo: Buffer) => ReturnType<typeof readDelivery>;

export function scorePhoto(expected: Expected[], suggestions: Suggestion[]) {
  let exactCounts = 0, wrongCounts = 0, missingListings = 0, withheldCounts = 0, guessedUnreadable = 0;
  let duplicateRows = 0, unexpectedListings = 0, unreadableCountsWithheld = 0;
  const expectedIds = new Set(expected.map(row => row.listingId));
  if (expectedIds.size !== expected.length) throw Error("Label each listing once per photo.");
  for (const row of expected) {
    const matches = suggestions.filter(s => s.listingId === row.listingId);
    if (!matches.length) { missingListings++; continue; }
    duplicateRows += matches.length - 1;
    if (row.units === null) {
      if (matches.some(m => m.units !== null)) guessedUnreadable++;
      else if (matches.length === 1) unreadableCountsWithheld++;
    } else if (matches.length === 1) {
      if (matches[0]!.units === null) withheldCounts++;
      else if (matches[0]!.units === row.units) exactCounts++;
      else wrongCounts++;
    }
  }
  for (const row of suggestions) {
    if (row.listingId !== null && !expectedIds.has(row.listingId)) unexpectedListings++;
  }
  return { labelledListings: expected.length, countableListings: expected.filter(r => r.units !== null).length,
    exactCounts, wrongCounts, missingListings, withheldCounts, guessedUnreadable, unreadableCountsWithheld, duplicateRows, unexpectedListings,
    unmatchedRows: suggestions.filter(s => s.listingId === null).length };
}

export async function evaluateDeliveries(photos: z.infer<typeof manifest>["photos"], listings: Listing[],
  load: (file: string) => Promise<Buffer>, read: Read) {
  const listingIds = new Set(listings.map(l => l.id));
  const hashes = new Set<string>();
  const totals = scorePhoto([], []);
  const results = [];
  for (const photo of photos) {
    if (photo.expected.some(r => !listingIds.has(r.listingId))) throw Error("Unknown store listing in " + photo.file);
    if (new Set(photo.expected.map(r => r.listingId)).size !== photo.expected.length) throw Error("Duplicate label in " + photo.file);
    const input = await load(photo.file);
    if (input.length > MAX_UPLOAD_BYTES) throw Error("Oversize photo: " + photo.file);
    const jpeg = await sanitizePhoto(input);
    const hash = createHash("sha256").update(jpeg).digest("hex");
    if (hashes.has(hash)) throw Error("Repeated photo: " + photo.file);
    hashes.add(hash);
    const reading = await read(jpeg);
    const suggestions = matchDelivery(reading.products, listings);
    const score = scorePhoto(photo.expected, suggestions);
    for (const key of Object.keys(totals) as (keyof typeof totals)[]) totals[key] += score[key];
    results.push({ file: photo.file, suggestions, score });
  }
  return { photos: results.length, totals, results };
}

async function main() {
  const { values } = parseArgs({ options: { dataset: { type: "string" } } });
  if (!values.dataset) {
    const { deliveryExamples } = await import("./delivery-placeholders.mjs");
    const examples = await deliveryExamples();
    const report = await evaluateDeliveries(examples.photos, examples.listings, examples.load, examples.read);
    console.log(JSON.stringify({ source: "placeholder", reader: "scripted", ...report }, null, 2));
    return;
  }
  const datasetPath = await realpath(values.dataset);
  const dataset = manifest.parse(JSON.parse(await readFile(datasetPath, "utf8")));
  const root = path.dirname(datasetPath);
  if (process.env.DELIVERY_EXTRACTION_ENABLED !== "yes") throw Error("Enable the configured delivery reader to run a live dataset.");
  const listings = await prisma.listing.findMany({ where: { storeId: dataset.storeId },
    select: { id: true, canonicalProduct: { select: { canonicalName: true, packSize: true, aliases: { select: { alias: true } } } } } });
  if (!listings.length) throw Error("The pilot store has no listings.");
  const report = await evaluateDeliveries(dataset.photos, listings, async file => {
    if (path.isAbsolute(file)) throw Error("Use photo paths relative to the manifest.");
    const absolute = await realpath(path.resolve(root, file));
    const relative = path.relative(root, absolute);
    if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative)) throw Error("Photo outside the dataset.");
    const info = await stat(absolute);
    if (!info.isFile() || info.size > MAX_UPLOAD_BYTES) throw Error("Invalid input photo: " + file);
    return readFile(absolute);
  }, jpeg => readDelivery(dataset.storeId, jpeg));
  console.log(JSON.stringify({ source: "user-dataset", reader: process.env.SHELF_VISION_MODEL, ...report }, null, 2));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; }).finally(() => prisma.$disconnect());
}
