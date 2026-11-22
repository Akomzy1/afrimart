import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { parseArgs } from "node:util";
import { pathToFileURL } from "node:url";
import sharp from "sharp";
import { z } from "zod";
import { assessFrame } from "../../apps/merchant/app/onboarding/capture.js";
import { mergeReadings, readingSchema, resolveProducts, type Seen } from "../../services/backend/src/catalogue/extraction.js";
import { CATALOGUE_AUTO_APPROVE_CONFIDENCE } from "../../services/backend/src/config.js";
import { align, datasetSchema, evaluateThresholds, type Review } from "./score.mjs";
import { digest, json, placeholders } from "./placeholders.mjs";

const vectors = z.record(z.string(), z.array(z.number().finite()).min(1));
const recording = z.object({
  model: z.string().min(1),
  embeddingModel: z.string().min(1).optional(),
  embeddings: z.object({ query: vectors, document: vectors }).optional(),
  batches: z.array(z.object({ hashes: z.array(z.string().regex(/^[0-9a-f]{64}$/)).min(1).max(4),
    readings: z.array(readingSchema) })).min(1),
});

async function gradeImage(bytes: Buffer) {
  const upright = await sharp(bytes).rotate().png().toBuffer({ resolveWithObject: true });
  const width = 160;
  const height = Math.max(32, Math.min(240, Math.round(width * upright.info.height / upright.info.width)));
  const rgba = await sharp(upright.data).resize(width, height, { fit: "fill" }).toColourspace("srgb").ensureAlpha().raw().toBuffer();
  return assessFrame(new Uint8ClampedArray(rgba), width, height).guidance;
}

export async function evaluate(input: unknown, read: (file: string) => Promise<Buffer>) {
  const dataset = datasetSchema.parse(input);
  const ids = new Set(dataset.products.map(p => p.id));
  if (ids.size !== dataset.products.length) throw Error("Duplicate catalogue SKU.");
  const captures = new Set<string>(), hashes = new Set<string>(), models = new Set<string>();
  const counts = { calibration: 0, validation: 0 };
  const reviews: Review[] = [];
  const quality = { correct: 0, falseAccepts: 0, falseRejects: 0, confusion: {} as Record<string, number> };
  for (const c of dataset.captures) {
    if (captures.has(c.id)) throw Error("Duplicate capture " + c.id);
    captures.add(c.id);
    if (c.truth.some(t => t.frames.some(i => i >= c.frames.length) || (t.sku !== null && !ids.has(t.sku)))) throw Error("Invalid label in " + c.id);
    const replay = recording.parse(JSON.parse((await read(c.recording)).toString()));
    if (dataset.source === "real-store" && replay.model === "scripted-placeholder-v1") throw Error("A placeholder recording cannot measure real-store accuracy.");
    if (replay.embeddings && !replay.embeddingModel) throw Error("Missing recorded embedding model.");
    models.add(JSON.stringify([replay.model, replay.embeddingModel ?? null]));
    if (models.size > 1) throw Error("Mixed model versions in dataset.");
    const seen: Seen[] = [];
    let index = 0;
    for (const batch of replay.batches) {
      const frames = c.frames.slice(index, index + batch.hashes.length);
      if (frames.length !== batch.hashes.length) throw Error("Extra recorded frames in " + c.id);
      for (const [i, frame] of frames.entries()) {
        const bytes = await read(frame.file);
        const hash = digest(bytes);
        if (hash !== batch.hashes[i]) throw Error("Recording hash mismatch for " + frame.file);
        if (hashes.has(hash)) throw Error("Duplicate image " + frame.file);
        hashes.add(hash);
        counts[c.split]++;
        const actual = await gradeImage(bytes);
        const key = frame.guidance + " -> " + actual;
        quality.confusion[key] = (quality.confusion[key] ?? 0) + 1;
        if (actual === frame.guidance) quality.correct++;
        else if (actual === "good") quality.falseAccepts++;
        else if (frame.guidance === "good") quality.falseRejects++;
      }
      for (const { frames: indices, ...row } of batch.readings) {
        if (indices.some(i => i >= frames.length)) throw Error("Invalid reading frame in " + c.id);
        seen.push({ ...row, frameNames: indices.map(i => frames[i].file) });
      }
      index += frames.length;
    }
    if (index !== c.frames.length) throw Error("Missing recorded frames in " + c.id);
    const drafts = await resolveProducts(mergeReadings(seen), dataset.products, {
      async read() { throw Error("Offline evaluator requires recorded readings."); },
      async embed(texts, kind) {
        return texts.map(text => {
          const vector = replay.embeddings?.[kind][text];
          if (!vector) throw Error("Missing recorded " + kind + " embedding in " + c.id);
          return vector;
        });
      },
    }, 0);
    reviews.push(align(c, drafts));
  }
  const [readingModel, embeddingModel] = JSON.parse([...models][0]) as [string, string | null];
  return { source: dataset.source, readingModel, embeddingModel, captures: captures.size,
    photos: counts, quality, ...evaluateThresholds(reviews, CATALOGUE_AUTO_APPROVE_CONFIDENCE, dataset.source, hashes.size) };
}

async function main() {
  const { values } = parseArgs({ options: { dataset: { type: "string" },
    "write-placeholders": { type: "string" }, report: { type: "string" } } });
  let dataset: unknown, read: (file: string) => Promise<Buffer>;
  if (values.dataset) {
    if (values["write-placeholders"]) throw Error("Choose a dataset or generate placeholders.");
    const root = path.dirname(path.resolve(values.dataset));
    dataset = JSON.parse(await readFile(values.dataset, "utf8"));
    read = file => {
      const relative = path.relative(root, path.resolve(root, file));
      if (relative === ".." || relative.startsWith(".." + path.sep) || path.isAbsolute(relative) || path.isAbsolute(file)) throw Error("Expected a dataset-relative file.");
      return readFile(path.join(root, relative));
    };
  } else {
    const generated = await placeholders();
    dataset = generated.dataset;
    read = async file => {
      const bytes = generated.files.get(file);
      if (!bytes) throw Error("Missing fixture " + file);
      return bytes;
    };
    const folder = values["write-placeholders"];
    if (folder) {
      await mkdir(path.dirname(path.resolve(folder)), { recursive: true });
      await mkdir(folder);
      for (const [file, bytes] of generated.files) await writeFile(path.join(folder, file), bytes, { flag: "wx" });
    }
  }
  const report = await evaluate(dataset, read);
  if (values.report) await writeFile(values.report, json(report), { flag: "wx" });
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  main().catch(error => { console.error(error.message); process.exitCode = 1; });
}
