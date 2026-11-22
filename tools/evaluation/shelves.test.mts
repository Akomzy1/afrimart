import assert from "node:assert/strict";
import test from "node:test";
import { align, evaluateThresholds, metrics, type Capture, type Draft } from "./score.mjs";
import { evaluate } from "./shelves.mjs";
import { placeholders } from "./placeholders.mjs";
import { resolveProducts } from "../../services/backend/src/catalogue/extraction.js";

const capture: Capture = { id: "one", split: "calibration", frames: [{ file: "frame", guidance: "good" }],
  recording: "recording", truth: [{ names: ["Rice"], brand: null, sku: "rice", priceCents: 200, packSize: "1 kg", frames: [0] }] };
const draft: Draft = { suggestedName: "Rice", rawText: "Rice", suggestedPriceCents: 200, packSize: "1000 g",
  brand: null, matchedProductId: "rice", confidence: .96, candidateIds: ["rice"], frameNames: ["frame"] };

test("duplicate detections count once and a wrong SKU cannot earn a correct selection", () => {
  const result = metrics([align(capture, [draft, { ...draft, matchedProductId: "other" }])], .9);
  assert.deepEqual(result.precision, { right: 1, total: 2, rate: .5 });
  assert.equal(result.incorrectSelections.right, 1);
  const wrong = metrics([align(capture, [{ ...draft, matchedProductId: "other" }])], .9);
  assert.equal(wrong.recall.rate, 1);
  assert.equal(wrong.incorrectSelections.right, 1);
});

test("missing and invented prices require review even with a permissive cutoff", async () => {
  const [row] = await resolveProducts([{ name: "Rice", rawText: "Rice", priceCents: null, packSize: "1 kg",
    confidence: 1, frameNames: ["frame"], brand: null }], [{ id: "rice", canonicalName: "Rice", packSize: "1 kg", aliases: [] }],
    { async read() { return []; }, async embed() { throw Error("unexpected embedding"); } }, 0);
  assert.equal(row.matchedProductId, null);
  const unreadable = { ...capture, truth: [{ ...capture.truth[0], priceCents: null }] };
  const result = metrics([align(unreadable, [draft])], .9);
  assert.equal(result.guessedUnreadablePrices, 1);
  assert.equal(result.incorrectSelections.right, 1);
  assert.equal(result.legiblePriceAccuracy.rate, null);
});

test("validation errors cannot influence calibration, and abstention cannot clear the real-store gate", () => {
  const calibration = align(capture, [draft]);
  const validation = align({ ...capture, split: "validation" }, [{ ...draft, suggestedPriceCents: 250 }]);
  const result = evaluateThresholds([calibration, validation], .92, "real-store", 36);
  assert.equal(result.candidateThreshold, .96);
  assert.equal(result.validation?.incorrectSelections.right, 1);
  assert.match(result.evidence, /incorrect selections on validation/);
  assert.match(evaluateThresholds([calibration], .92, "real-store", 36).evidence, /insufficient/);
});

test("36 placeholder photos reproduce the scripted misses, spurious detections and price errors", async () => {
  const { dataset, files } = await placeholders();
  const read = async (file: string) => files.get(file)!;
  const result = await evaluate(dataset, read);
  assert.deepEqual(result.photos, { calibration: 18, validation: 18 });
  assert.deepEqual(result.current.recall, { right: 32, total: 36, rate: 32/36 });
  assert.equal(result.current.precision.total, 36);
  assert.deepEqual(result.current.legiblePriceAccuracy, { right: 22, total: 32, rate: 22/32 });
  assert.equal(result.calibrationSweep.find(row => row.threshold === .94)?.wrong, 3);
  assert.equal(result.validation?.incorrectSelections.right, 0);
  assert.equal(result.validation?.selections, 9);
  assert.deepEqual(result.quality.confusion, {
    "good -> good": 24, "dark -> dark": 3, "glare -> glare": 3, "blur -> blur": 3, "far -> far": 3,
  });
  assert.match(result.evidence, /real-store gate unassessed/);
  await assert.rejects(evaluate({ ...dataset, source: "real-store" }, read), /placeholder recording/);
  const first = dataset.captures[0];
  await assert.rejects(evaluate(dataset, file => read(file === first.frames[0].file ? first.frames[1].file : file)), /hash mismatch/);
  await assert.rejects(evaluate({ ...dataset, captures: [first, { ...first, id: "duplicate", split: "validation" }] }, read), /Duplicate image/);
});
