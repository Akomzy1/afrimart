import { createHash } from "node:crypto";
import sharp from "sharp";
import type { Capture, Dataset } from "./score.mjs";
import type { Reading } from "../../services/backend/src/catalogue/extraction.js";

const products = [
  ["rice", "Ofada Rice", "1 kg"], ["oil", "Palm Oil", "500 ml"],
  ["garri", "White Garri", "750 g"], ["beans", "Honey Beans", "2 kg"],
  ["spice", "Suya Spice", "80 g"], ["flour", "Yam Flour", "900 g"],
].map(([id, canonicalName, packSize]) => ({ id, canonicalName, packSize, aliases: [] }));

export const digest = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");
export const json = (value: unknown) => Buffer.from(JSON.stringify(value, null, 2) + "\n");

async function shelfImage(truth: Capture["truth"], scene: number, view: number, guidance: string) {
  const tags = truth.map((label, index) => {
    const x = 20 + index * 155 + view * 4;
    const fill = ["#639555", "#ca9356", "#568eaf", "#ce7078"][(scene + index) % 4];
    const price = label.priceCents === null ? "----" : (label.priceCents / 100).toFixed(2);
    return '<g transform="translate(' + x + ',24)"><rect width="135" height="95" fill="' + fill +
      '"/><rect x="6" y="32" width="123" height="47" fill="white"/><text x="10" y="52">' +
      label.names[0] + '</text><text x="10" y="72">' + label.packSize +
      '</text><rect y="102" width="135" height="38" fill="white"/><text x="9" y="127">$' +
      price + '</text></g>';
  }).join("");
  let content = '<rect width="480" height="210" fill="#888"/>' + tags;
  if (guidance === "dark" || guidance === "glare") content += '<rect width="480" height="210" opacity=".98" fill="' + (guidance === "dark" ? "black" : "white") + '"/>';
  if (guidance === "far") content = '<rect width="480" height="210" fill="#888"/><g transform="translate(218 85) scale(.08)">' + tags + '</g>';
  content += '<rect x="' + (2+scene*4) + '" y="2" width="4" height="4"/>';
  const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="480" height="210" font-family="sans-serif" font-size="16" fill="#111">' + content + '</svg>';
  const pipeline = sharp(Buffer.from(svg));
  if (guidance === "blur") pipeline.blur(18);
  return pipeline.jpeg({ quality: 92 }).toBuffer();
}

export async function placeholders() {
  const files = new Map<string, Buffer>();
  const dataset: Dataset = { source: "placeholder", products, captures: [] };
  for (let scene = 0; scene < 12; scene++) {
    const id = "shelf-" + String(scene + 1).padStart(2, "0");
    const truth: Capture["truth"] = [];
    const readings: Reading[] = [];
    for (let slot = 0; slot < 3; slot++) {
      const product = products[(scene + slot) % products.length];
      const price = slot === 2 && scene % 3 === 0 ? null : 200 + scene * 11 + slot * 47;
      truth.push({ names: [product.canonicalName], brand: null, packSize: product.packSize,
        sku: product.id, priceCents: price, frames: [0, 1] });
      if (slot === 2 && scene % 3 === 1) continue; // Script a missed product.
      const wrongPrice = slot === 1 && scene % 2 === 0;
      const reading = { name: product.canonicalName, rawText: product.canonicalName, brand: null,
        packSize: product.packSize, priceCents: wrongPrice ? price! + 100 : price,
        confidence: wrongPrice ? .94 : slot === 2 ? .83 : .98 };
      for (const frame of [0, 1]) readings.push({ ...reading, frames: [frame] });
    }
    if (scene % 3 === 2) readings.push({ name: "Cocoa", rawText: "Cocoa", packSize: "50 g",
      brand: null, priceCents: 99, confidence: .88, frames: [0] });
    const poor = (["dark", "glare", "blur", "far"] as const)[scene % 4];
    const capture: Capture = { id, split: scene < 6 ? "calibration" : "validation", truth,
      recording: id + ".json", frames: [] };
    const hashes: string[] = [];
    for (const [view, guidance] of (["good", "good", poor] as const).entries()) {
      const file = id + "-" + view + ".jpg";
      const bytes = await shelfImage(truth, scene, view, guidance);
      files.set(file, bytes);
      hashes.push(digest(bytes));
      capture.frames.push({ file, guidance });
    }
    files.set(capture.recording, json({ model: "scripted-placeholder-v1", batches: [{ hashes, readings }] }));
    dataset.captures.push(capture);
  }
  files.set("manifest.json", json(dataset));
  return { dataset, files };
}
