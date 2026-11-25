import assert from "node:assert/strict";
import test from "node:test";
import { evaluateDeliveries, scorePhoto } from "./deliveries.mjs";
import { deliveryExamples } from "./delivery-placeholders.mjs";

test("the six scripted deliveries exercise matching, unit counts and unreadable cartons", async () => {
  const f = await deliveryExamples();
  const result = await evaluateDeliveries(f.photos, f.listings, f.load, f.read);
  assert.equal(result.photos, 6);
  assert.deepEqual(result.totals, { labelledListings: 8, countableListings: 6, exactCounts: 3,
    wrongCounts: 1, missingListings: 2, withheldCounts: 0, guessedUnreadable: 1, unreadableCountsWithheld: 1,
    duplicateRows: 0, unexpectedListings: 1, unmatchedRows: 1 });
  await assert.rejects(evaluateDeliveries([f.photos[0]!, f.photos[0]!], f.listings, f.load, f.read), /Repeated photo/);
});

test("duplicate suggestions cannot earn an exact count, and a blank count differs from a missed listing", () => {
  const rice = { listingId: "rice", units: 2 };
  const beans = { listingId: "beans", units: 3 };
  const scores = scorePhoto([rice, beans], [rice, rice, { ...beans, units: null }]);
  assert.equal(scores.exactCounts, 0);
  assert.equal(scores.duplicateRows, 1);
  assert.equal(scores.withheldCounts, 1);
  assert.equal(scores.missingListings, 0);
});
