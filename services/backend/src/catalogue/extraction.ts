import { z } from "zod";
import { CATALOGUE_AUTO_APPROVE_CONFIDENCE } from "../config.js";

const text = z.string().trim().min(1).max(300);
export const readingSchema = z.object({
  rawText: text, name: text, brand: text.nullable(), packSize: text.nullable(),
  priceCents: z.number().int().positive().max(10_000_000).nullable(),
  confidence: z.number().min(0).max(1), frames: z.array(z.number().int().nonnegative()).min(1).max(4),
});
export type Reading = z.infer<typeof readingSchema>;
export type Seen = Omit<Reading, "frames"> & { frameNames: string[] };
export type Product = { id: string; canonicalName: string; packSize: string; aliases: { alias: string }[] };
export interface Reader {
  read(images: Buffer[], batch: number): Promise<Reading[]>;
  embed(texts: string[], type: "query" | "document"): Promise<number[][]>;
}
export const normalize = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();

export function packKey(value: string) {
  const compact = normalize(value.replace(/(\d)\.(\d)/g, "$1decimal$2")).replace(/\s/g, "").replace("decimal", ".");
  const unit = /^(\d+(?:\.\d+)?)(kg|g|ml|l)$/.exec(compact);
  if (!unit) return compact;
  return String(Number(unit[1]) * (unit[2] === "kg" || unit[2] === "l" ? 1000 : 1)) + (["kg","g"].includes(unit[2]!) ? "g" : "ml");
}

export function mergeReadings(rows: Seen[]) {
  const merged = new Map<string, Seen>();
  for (const row of rows) {
    const key = JSON.stringify([normalize(row.name), normalize(row.brand ?? ""), packKey(row.packSize ?? ""), row.priceCents]);
    const old = merged.get(key);
    if (!old) { merged.set(key, { ...row, frameNames: [...new Set(row.frameNames)] }); continue; }
    const frames = [...new Set([...old.frameNames, ...row.frameNames])];
    merged.set(key, { ...(row.confidence > old.confidence ? row : old), frameNames: frames });
  }
  return [...merged.values()];
}

function similarity(a: string, b: string) {
  if (a === b) return 1;
  const grams = (s: string) => new Set(Array.from(" " + s, (_, i) => (" " + s + " ").slice(i, i+2)));
  const x = grams(a), y = grams(b);
  return 2 * [...x].filter(g => y.has(g)).length / (x.size + y.size);
}

function cosine(a: number[], b: number[]) {
  if (!a.length || a.length !== b.length) throw new Error("Invalid embedding dimensions.");
  let dot = 0, na = 0, nb = 0;
  for (let i = 0; i < a.length; i++) { dot += a[i]! * b[i]!; na += a[i]! ** 2; nb += b[i]! ** 2; }
  return na && nb ? Math.max(0, Math.min(1, dot / Math.sqrt(na*nb))) : 0;
}

export async function resolveProducts(rows: Seen[], products: Product[], reader: Reader | null, threshold = CATALOGUE_AUTO_APPROVE_CONFIDENCE) {
  let docs: number[][] | undefined;
  const drafts = [];
  for (const row of rows) {
    const compatible = products.map((p, index) => ({ p, index })).filter(({p}) =>
      !row.packSize || packKey(p.packSize) === packKey(row.packSize));
    const scores = compatible.map(({p, index}) => ({
      id: p.id, index, score: Math.max(...[p.canonicalName, ...p.aliases.map(a => a.alias)].map(alias =>
        Math.max(similarity(normalize(row.name), normalize(alias)), similarity(normalize(row.rawText), normalize(alias))))),
    }));
    if (reader && scores.length && !scores.some(x => x.score >= 0.9)) {
      docs ??= await reader.embed(products.map(p => [p.canonicalName, ...p.aliases.map(a => a.alias), p.packSize].join(" · ")), "document");
      const [query] = await reader.embed([[row.name, row.rawText, row.brand, row.packSize].filter(Boolean).join(" · ")], "query");
      if (!query || docs.length !== products.length) throw new Error("Incomplete embedding response.");
      for (const s of scores) s.score = Math.max(s.score, cosine(query, docs[s.index]!));
    }
    const ranked = scores.sort((a,b) => b.score - a.score).filter(s => s.score >= 0.65).slice(0,3);
    const top = ranked[0];
    const confidence = Math.min(row.confidence, top?.score ?? 0, row.priceCents === null ? 0.5 : 1);
    const clear = top && row.priceCents !== null && confidence >= threshold && !!row.packSize && top.score - (ranked[1]?.score ?? 0) >= 0.05;
    drafts.push({ rawText: row.rawText, suggestedName: row.name, brand: row.brand, packSize: row.packSize,
      suggestedPriceCents: row.priceCents, confidence, matchedProductId: clear ? top.id : null,
      candidateIds: ranked.map(r => r.id), frameNames: row.frameNames });
  }
  return drafts;
}
