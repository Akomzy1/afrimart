import { z } from "zod";
import { normalize, packKey, resolveProducts } from "../../services/backend/src/catalogue/extraction.js";

const name = z.string().trim().min(1);
const photoIndex = z.number().int().nonnegative();
export const captureSchema = z.object({
  id: name, split: z.enum(["calibration", "validation"]),
  frames: z.array(z.object({ file: name, guidance: z.enum(["good","dark","glare","far","blur"]) })).min(1).max(60),
  truth: z.array(z.object({
    names: z.array(name).min(1), brand: name.nullable(), packSize: name.nullable(),
    sku: name.nullable(), priceCents: z.number().int().positive().nullable(), frames: z.array(photoIndex).min(1),
  })), recording: name,
});
export const datasetSchema = z.object({
  source: z.enum(["placeholder","real-store"]),
  products: z.array(z.object({ id: name, canonicalName: name, packSize: name, aliases: z.array(z.object({ alias: name })) })).min(1),
  captures: z.array(captureSchema).min(1),
});
export type Capture = z.infer<typeof captureSchema>;
export type Dataset = z.infer<typeof datasetSchema>;
export type Draft = Awaited<ReturnType<typeof resolveProducts>>[number];
export type Review = ReturnType<typeof align>;

// Count a detected product once, regardless of the number of supporting frames.
// Use identity and overlapping evidence to pair detections, never the predicted
// price, proposed SKU or confidence. This keeps those measurements independent.
export function align(capture: Capture, drafts: Draft[]) {
  const names = capture.truth.map(t => new Set(t.names.map(normalize)));
  const possible = drafts.map(d => capture.truth.flatMap((t, i) =>
    (names[i].has(normalize(d.suggestedName)) || names[i].has(normalize(d.rawText))) &&
    (!t.packSize || packKey(t.packSize) === packKey(d.packSize ?? "")) &&
    (!t.brand || normalize(t.brand) === normalize(d.brand ?? "")) &&
    t.frames.some(n => d.frameNames.includes(capture.frames[n].file)) ? [i] : []));
  // Maximum one-to-one matching avoids counting duplicate predictions as hits.
  const paired = new Map<number, number>();
  function match(d: number, seen: Set<number>): boolean {
    for (const t of possible[d]) {
      if (seen.has(t)) continue;
      seen.add(t);
      const other = paired.get(t);
      if (other === undefined || match(other, seen)) { paired.set(t,d); return true; }
    }
    return false;
  }
  for (let d = 0; d < drafts.length; d++) match(d, new Set());
  const truthFor = new Map([...paired].map(([t,d]) => [d,t]));
  const predictions = drafts.map((d, i) => {
    const t = truthFor.get(i);
    const label = t === undefined ? undefined : capture.truth[t];
    // Ambiguous labels cannot substantiate an automatic selection.
    const correctSelection = !!label && possible[i].length === 1 && label.sku !== null &&
      label.sku === d.matchedProductId && label.priceCents !== null && label.priceCents === d.suggestedPriceCents &&
      d.frameNames.every(file => label.frames.some(index => capture.frames[index].file === file));
    return { name: d.suggestedName, matched: t, confidence: d.confidence, selected: d.matchedProductId,
      priceCents: d.suggestedPriceCents, correctSelection };
  });
  return { id: capture.id, split: capture.split, truth: capture.truth, predictions };
}

const fraction = (right: number, total: number) => ({ right, total, rate: total ? right/total : null });

export function metrics(rows: Review[], threshold: number) {
  let expected = 0, detected = 0, hits = 0, legible = 0, rightPrices = 0, guessedPrices = 0;
  let selected = 0, wrong = 0;
  const wrongSelections: { capture: string; name: string }[] = [];
  for (const r of rows) {
    expected += r.truth.length;
    legible += r.truth.filter(t => t.priceCents !== null).length;
    for (const p of r.predictions) {
      detected++;
      const t = p.matched === undefined ? undefined : r.truth[p.matched];
      if (t) {
        hits++;
        if (t.priceCents !== null && t.priceCents === p.priceCents) rightPrices++;
        if (t.priceCents === null && p.priceCents !== null) guessedPrices++;
      }
      if (p.selected && p.confidence >= threshold) {
        selected++;
        if (!p.correctSelection) { wrong++; wrongSelections.push({ capture: r.id, name: p.name }); }
      }
    }
  }
  return { threshold, precision: fraction(hits,detected), recall: fraction(hits,expected),
    legiblePriceAccuracy: fraction(rightPrices,legible), guessedUnreadablePrices: guessedPrices,
    selections: selected, incorrectSelections: fraction(wrong,selected), wrongSelections };
}

export function evaluateThresholds(rows: Review[], current: number, source: Dataset["source"], photos: number) {
  const calibration = rows.filter(r => r.split === "calibration"), validation = rows.filter(r => r.split === "validation");
  const candidates = [...new Set([0, current, 1, ...calibration.flatMap(r => r.predictions.filter(p => p.selected).map(p => p.confidence))])].sort((a,b) => a-b);
  const sweep = candidates.map(t => metrics(calibration,t));
  // For equal coverage prefer the highest cutoff supported by calibration observations.
  const choice = sweep.filter(m => m.selections > 0 && m.incorrectSelections.right === 0)
    .sort((a,b) => b.selections-a.selections || b.threshold-a.threshold)[0];
  const holdout = choice ? metrics(validation,choice.threshold) : null;
  let evidence: string;
  if (source === "placeholder") evidence = "placeholder run; real-store gate unassessed";
  else if (photos < 30 || !choice || !holdout?.selections) evidence = "insufficient real-store evidence";
  else evidence = holdout.incorrectSelections.right ? "incorrect selections on validation" : "zero incorrect selections on this real-store set";
  return { current: metrics(rows,current), calibrationSweep: sweep.map(m => ({ threshold: m.threshold, selections: m.selections, wrong: m.incorrectSelections.right })),
    candidateThreshold: choice?.threshold ?? null, validation: holdout, evidence };
}
