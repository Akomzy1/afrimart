import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";

import { assessClaim, BUYER_ITEM_REASONS } from "./refunds.js";
import { claimRef, claimStage, hadCarrierScan, itemReportBlock, parcelReportBlock, toClaimView } from "./claims.js";
import { LocalRefundIssuer } from "../payments/refunds.js";
import { renderEmail, subjectFor } from "../notifications/render.js";
import { REFUND_AUTO_APPROVE_CENTS } from "../config.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const DAY = 86_400_000;

describe("QC-3 when each kind of report is offered", () => {
  test("item reports need the parcel to have arrived", () => {
    assert.equal(itemReportBlock("delivered"), null);
    for (const s of ["pending", "label_created", "picked_up", "in_transit", "exception"] as const) {
      assert.ok(itemReportBlock(s), `${s} must not offer an item report`);
    }
  });

  test("a parcel that is still on its way, inside its expected date, cannot be reported", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    assert.ok(parcelReportBlock({ status: "in_transit", estimatedDelivery: new Date(now.getTime() + DAY) }, now));
    assert.ok(parcelReportBlock({ status: "label_created", estimatedDelivery: new Date(now.getTime() + 3 * DAY) }, now));
  });

  test("once the expected date has passed, it can", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    assert.equal(parcelReportBlock({ status: "in_transit", estimatedDelivery: new Date(now.getTime() - DAY) }, now), null);
  });

  test("or as soon as tracking shows delivered, whatever the date", () => {
    const now = new Date("2026-10-14T12:00:00Z");
    assert.equal(parcelReportBlock({ status: "delivered", estimatedDelivery: new Date(now.getTime() + 5 * DAY) }, now), null);
  });

  test("a parcel with no expected date and not delivered is not yet reportable", () => {
    assert.ok(parcelReportBlock({ status: "in_transit", estimatedDelivery: null }));
  });

  test("the carrier-scan test: only a parcel that never got past the label never left the seller", () => {
    assert.equal(hadCarrierScan("pending"), false);
    assert.equal(hadCarrierScan("label_created"), false);
    for (const s of ["picked_up", "in_transit", "delivered", "exception"] as const) assert.equal(hadCarrierScan(s), true, s);
  });
});

describe("QC-3 the decision a report gets", () => {
  const base = { amountCents: 500, priorClaims: 0, trackingShowsFailure: false, photoUrl: "/photos/claim/x.jpg" };

  test("a small clean item report is refunded at once", () => {
    for (const reason of ["damaged", "spoiled", "wrong_item", "inauthentic"] as const) {
      assert.equal(assessClaim({ ...base, reason }).status, "auto_approved", reason);
    }
  });

  test("'missing from the box' is never auto-approved: a person checks it against the packing photo", () => {
    const d = assessClaim({ ...base, reason: "missing_items", amountCents: 100 });
    assert.equal(d.status, "manual_review");
    assert.match(d.reasonGiven, /packing photo/);
    assert.equal(d.recoveryTarget, "seller", "the seller packed the box");
  });

  test("a parcel that never arrived needs no photo and is always reviewed", () => {
    const d = assessClaim({ reason: "not_delivered", amountCents: 100, priorClaims: 0, trackingShowsFailure: true, hadCarrierScan: true });
    assert.equal(d.status, "manual_review");
    assert.equal(d.recoveryTarget, "carrier");
  });

  test("scanned goes to the carrier; never scanned goes to the seller", () => {
    const common = { reason: "not_delivered" as const, amountCents: 100, priorClaims: 0, trackingShowsFailure: false };
    assert.equal(assessClaim({ ...common, hadCarrierScan: true }).recoveryTarget, "carrier");
    assert.equal(assessClaim({ ...common, hadCarrierScan: false }).recoveryTarget, "seller");
  });

  test("every item reason is refused without a photo", () => {
    for (const reason of BUYER_ITEM_REASONS) {
      assert.equal(assessClaim({ ...base, reason, photoUrl: null }).status, "rejected", reason);
    }
  });

  test("a repeat claimant and a large claim go to a person", () => {
    assert.equal(assessClaim({ ...base, reason: "damaged", priorClaims: 5 }).status, "manual_review");
    assert.equal(assessClaim({ ...base, reason: "damaged", amountCents: REFUND_AUTO_APPROVE_CENTS + 1 }).status, "manual_review");
  });
});

describe("QC-3 how a report is shown back to the buyer", () => {
  test("'refunded' means a refund was issued, not merely approved", () => {
    assert.equal(claimStage({ status: "approved", refundedAt: null }), "review");
    assert.equal(claimStage({ status: "auto_approved", refundedAt: null }), "review");
    assert.equal(claimStage({ status: "approved", refundedAt: new Date() }), "refunded");
    assert.equal(claimStage({ status: "rejected", refundedAt: null }), "declined");
  });

  test("the reference is short, stable and carries no personal data", () => {
    assert.equal(claimRef("cmuabcdefgh1234"), "R-1234");
    assert.equal(claimRef("cmuabcdefgh1234"), claimRef("cmuabcdefgh1234"));
  });

  test("a parcel report covers no items; an item report names them", () => {
    const base = { id: "c1abcd", reason: "damaged", amountCents: 100, status: "manual_review", refundedAt: null, createdAt: new Date() };
    assert.deepEqual(toClaimView({ ...base, kind: "parcel", items: [] }).itemIds, []);
    assert.deepEqual(toClaimView({ ...base, kind: "item", items: [{ shipmentItemId: "a" }, { shipmentItemId: "b" }] }).itemIds, ["a", "b"]);
  });
});

describe("QC-8 refunds are issued once", () => {
  const issuer = new LocalRefundIssuer();
  const env = process.env.NODE_ENV;
  const restore = () => {
    if (env === undefined) delete process.env.NODE_ENV;
    else process.env.NODE_ENV = env;
  };

  test("the same claim always yields the same refund, so a retry pays nothing more", async () => {
    const a = await issuer.issue({ claimId: "claim-1", orderId: "o", amountCents: 450 });
    const b = await issuer.issue({ claimId: "claim-1", orderId: "o", amountCents: 450 });
    assert.equal(a.refundId, b.refundId);
    assert.notEqual(a.refundId, (await issuer.issue({ claimId: "claim-2", orderId: "o", amountCents: 450 })).refundId);
  });

  test("it refuses a zero, negative or fractional amount", async () => {
    for (const amountCents of [0, -5, 4.5]) {
      await assert.rejects(issuer.issue({ claimId: "c", orderId: "o", amountCents }));
    }
  });

  test("the stand-in refuses to 'refund' anyone in production", async () => {
    process.env.NODE_ENV = "production";
    try {
      await assert.rejects(issuer.issue({ claimId: "c", orderId: "o", amountCents: 100 }), /disabled here/);
    } finally {
      restore();
    }
  });

  test("a claim is marked refunded only after the issuer succeeds, and only once", async () => {
    const svc = await src("./claimService.ts");
    assert.ok(svc.indexOf("refundIssuer.issue(") < svc.indexOf("updateMany("), "marked refunded before the money went");
    assert.match(svc, /where: \{ id: claim\.id, refundedAt: null \}/);
    assert.match(svc, /if \(claim\.refundedAt\) return/);
    assert.match(svc, /queueRefundIssued\(/);
  });
});

describe("QC-3 the buyer's identity and photos cannot be bypassed", () => {
  test("every procedure in the orders and claims routers is a buyerProcedure", async () => {
    for (const file of ["orders.ts", "claims.ts"]) {
      const text = await src(`../routers/${file}`);
      const procs = [...text.matchAll(/^\s{2}(\w+):\s*(\w+Procedure)\b/gm)];
      assert.ok(procs.length >= 2, file);
      for (const [, name, builder] of procs) assert.equal(builder, "buyerProcedure", `${file}:${name}`);
    }
  });

  test("a parcel is reached only through its own buyer's order", async () => {
    const claims = await src("../routers/claims.ts");
    assert.match(claims, /order: \{ buyerId \}/);
    assert.match(claims, /ownParcel\(ctx\.buyerId/);
    const orders = await src("../routers/orders.ts");
    assert.match(orders, /where: \{ buyerId/);
    assert.match(orders, /Someone else's order is indistinguishable/);
  });

  test("a claim photo only ever comes from the photo store, and is required for item reports", async () => {
    const claims = await src("../routers/claims.ts");
    assert.match(claims, /photoStore\.put\("claim", decodeUpload\(input\.photo\)\)/);
    assert.match(claims, /photo: z\.string\(\)\.min\(1\)/);
    assert.ok(!/photoUrl:\s*input\./.test(claims), "a client-supplied url is stored as a claim photo");
  });

  test("the parcel report takes no photo and cannot be auto-approved", async () => {
    const claims = await src("../routers/claims.ts");
    const parcel = claims.slice(claims.indexOf("submitParcelReport:"));
    assert.ok(!/photo:/.test(parcel.slice(0, parcel.indexOf(".mutation("))));
    assert.match(parcel, /reason: "not_delivered"/);
    assert.ok(!/refundClaim\(/.test(parcel), "a parcel report must never trigger a refund directly");
  });

  test("only an auto-approved item report is refunded without a person", async () => {
    const claims = await src("../routers/claims.ts");
    const idx = claims.indexOf("refundClaim(claim.id)");
    assert.ok(idx > -1);
    assert.match(claims.slice(Math.max(0, idx - 120), idx), /decision\.status === "auto_approved"/);
  });

  test("the same goods cannot be refunded twice", async () => {
    const claims = await src("../routers/claims.ts");
    assert.match(claims, /claim: \{ status: \{ not: "rejected" \} \}/);
    assert.match(claims, /kind: "parcel", status: \{ not: "rejected" \}/);
  });

  test("the buyer is never shown the seller's packing photo", async () => {
    const orders = await src("../routers/orders.ts");
    assert.match(orders, /packed: s\.packingPhotoUrl !== null/);
    assert.ok(!/packingPhotoUrl:/.test(orders), "the packing photo url is returned to the buyer");
  });

  test("the ops claim queue carries both photos, so a reviewer can compare them", async () => {
    const admin = await src("../routers/admin.ts");
    const q = admin.slice(admin.indexOf("refundClaims: staffProcedure"), admin.indexOf("resolveRefundClaim: staffProcedure"));
    assert.match(q, /packingPhotoUrl: shipment\?\.packingPhotoUrl/);
    assert.match(q, /photoUrl: c\.photoUrl/);
  });

  test("approving a claim issues the refund after the decision is recorded and audited", async () => {
    const admin = await src("../routers/admin.ts");
    const r = admin.slice(admin.indexOf("resolveRefundClaim: staffProcedure"));
    assert.ok(r.indexOf("writeAudit(") < r.indexOf("refundClaim("));
    assert.match(r, /Approve again to retry/);
  });

  test("no buyer-facing router names a buyer or store id in an input", async () => {
    const dir = new URL("../routers/", import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => ["orders.ts", "claims.ts"].includes(f))) {
      const text = (await readFile(new URL(file, dir), "utf8")).replace(/\/\/.*$/gm, "");
      assert.ok(!/\b(buyerId|storeId)\s*:\s*z\./.test(text), file);
    }
  });
});

describe("the claim emails say true things", () => {
  test("no template carries a sample amount or a sample report reference", async () => {
    const dir = new URL("../notifications/templates/", import.meta.url);
    for (const file of (await readdir(dir)).filter((f) => f.endsWith(".html"))) {
      const html = await readFile(new URL(file, dir), "utf8");
      assert.ok(!/AM-C-\d/.test(html), `${file} carries a demo report reference`);
      assert.ok(!/AM-\d{4}-\d{3}/.test(html), `${file} carries a demo order reference`);
    }
    const refund = await readFile(new URL("refund-issued.html", dir), "utf8");
    assert.ok(!/\$\d/.test(refund.replace(/\{\{[^}]*\}\}/g, "")), "the refund email has a literal dollar amount");
  });

  test("the refund email states the amount actually refunded, in the title and the body", async () => {
    const ctx = { orderRef: "AM-ABC1234", reportRef: "R-9F3A", refundAmount: "$4.20", paymentMethod: "your original payment method", items: [] };
    const html = await renderEmail("refund-issued", ctx);
    assert.ok(html.includes("$4.20"));
    assert.ok(!html.includes("13.50"), "the demo amount leaked into a real email");
    assert.ok(html.includes("AM-ABC1234") && html.includes("R-9F3A"));
    assert.equal(subjectFor("refund-issued", ctx), "We've refunded $4.20 to your card");
  });

  test("the report emails carry this report's reference", async () => {
    const item = await renderEmail("report-received-item", { orderRef: "AM-ABC1234", reportRef: "R-9F3A", items: [] });
    const parcel = await renderEmail("report-received-parcel", { orderRef: "AM-ABC1234", reportRef: "R-9F3A" });
    for (const html of [item, parcel]) {
      assert.ok(html.includes("R-9F3A") && !html.includes("AM-C-"), "wrong or missing report reference");
    }
  });
});
