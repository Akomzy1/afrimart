import { createHash } from "node:crypto";
import sharp from "sharp";
import { sanitizePhoto } from "../../services/backend/src/storage/photos.js";

const listings = [
  ["rice", "Ofada Rice", "1 kg"], ["oil", "Palm Oil", "500 ml"],
  ["beans-small", "Honey Beans", "500 g"], ["beans-large", "Honey Beans", "1 kg"],
].map(([id, canonicalName, packSize]) => ({ id: id!, canonicalProduct: {
  canonicalName: canonicalName!, packSize: packSize!, aliases: id === "rice" ? [{ alias: "Ofada" }] : [],
} }));
const label = (listingId: string, units: number | null) => ({ listingId, units });
const row = (name: string, packSize: string | null, units: number | null) => ({ name, packSize, units });
const examples = [
  { file: "loose-packs", packs: ["Ofada / 1 kg", "Ofada / 1 kg", "Palm Oil / 500 ml"],
    expected: [label("rice", 2), label("oil", 1)], reading: [row("Ofada", "1000 g", 2), row("Palm Oil", "0.5 L", 1)] },
  { file: "labelled-cartons", packs: ["Palm Oil / 6 x 500 ml", "Palm Oil / 6 x 500 ml"],
    expected: [label("oil", 12)], reading: [row("Palm Oil", "500 ml", 2)] },
  { file: "sealed-carton", packs: ["Ofada Rice / 1 kg packs"],
    expected: [label("rice", null)], reading: [row("Ofada Rice", "1 kg", null)] },
  { file: "invented-carton-count", packs: ["Palm Oil / 500 ml bottles"],
    expected: [label("oil", null)], reading: [row("Palm Oil", "500 ml", 6)] },
  { file: "mixed-delivery", packs: ["Ofada Rice / 1 kg", "Honey Beans / 500 g"],
    expected: [label("rice", 1), label("beans-small", 1)], reading: [row("Ofada Rice", "1 kg", 1), row("Palm Oil", "500 ml", 1)] },
  { file: "ambiguous-size", packs: ["Honey Beans / 1 kg"],
    expected: [label("beans-large", 1)], reading: [row("Honey Beans", null, 1)] },
];
const hash = (bytes: Buffer) => createHash("sha256").update(bytes).digest("hex");

export async function deliveryExamples() {
  const images = new Map<string, Buffer>();
  const readings = new Map<string, typeof examples[number]["reading"]>();
  for (const example of examples) {
    const packs = example.packs.map((text, i) => {
      const x = 16 + i * 210;
      return '<g transform="translate(' + x + ' 24)"><rect width="200" height="96" fill="#bd976a"/>' +
        '<rect x="6" y="32" width="188" height="32" fill="white"/><text x="10" y="53">' + text + '</text></g>';
    });
    const svg = '<svg xmlns="http://www.w3.org/2000/svg" width="650" height="150" font-family="sans-serif" font-size="14">' +
      '<rect width="650" height="150" fill="#e8e6dd"/>' + packs.join("") + '</svg>';
    const jpeg = await sharp(Buffer.from(svg)).jpeg().toBuffer();
    images.set(example.file, jpeg);
    readings.set(hash(await sanitizePhoto(jpeg)), example.reading);
  }
  return { listings, photos: examples.map(({ file, expected }) => ({ file, expected })),
    load: async (file: string) => images.get(file)!,
    read: async (image: Buffer) => {
      const products = readings.get(hash(image));
      if (!products) throw Error("Unrecognised placeholder photo.");
      return { products };
    } };
}
