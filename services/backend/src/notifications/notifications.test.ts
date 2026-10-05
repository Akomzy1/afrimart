import { test, describe } from "node:test";
import assert from "node:assert/strict";

import { canAdvanceShipment, canAdvanceOrder, deriveOrderStatus, mapCarrierStatus } from "./state.js";
import { renderEmail, shippedTemplateFor, subjectFor } from "./render.js";

describe("NTF-1 state never moves backwards", () => {
  test("a delivered parcel cannot revert", () => {
    for (const s of ["pending", "label_created", "picked_up", "in_transit", "exception"] as const) {
      assert.equal(canAdvanceShipment("delivered", s), false, `delivered -> ${s} must be refused`);
    }
  });

  test("forward moves are allowed, repeats are not", () => {
    assert.equal(canAdvanceShipment("pending", "picked_up"), true);
    assert.equal(canAdvanceShipment("picked_up", "in_transit"), true);
    assert.equal(canAdvanceShipment("in_transit", "picked_up"), false, "an out-of-order event");
    assert.equal(canAdvanceShipment("in_transit", "in_transit"), false, "a duplicate");
  });

  test("an exception can interrupt from anywhere except delivered", () => {
    assert.equal(canAdvanceShipment("pending", "exception"), true);
    assert.equal(canAdvanceShipment("in_transit", "exception"), true);
    assert.equal(canAdvanceShipment("delivered", "exception"), false, "a landed parcel has landed");
  });

  test("an order is only delivered once every parcel is", () => {
    assert.equal(deriveOrderStatus(["delivered", "in_transit"], "shipped"), "shipped");
    assert.equal(deriveOrderStatus(["delivered", "delivered"], "shipped"), "delivered");
  });

  test("a cancelled order stays cancelled", () => {
    assert.equal(deriveOrderStatus(["delivered"], "cancelled"), "cancelled");
    assert.equal(canAdvanceOrder("cancelled", "delivered"), false);
  });

  test("unknown carrier vocabulary is mapped or refused, never guessed", () => {
    assert.equal(mapCarrierStatus("Out for delivery"), "in_transit");
    assert.equal(mapCarrierStatus("PRE_TRANSIT"), "label_created");
    assert.equal(mapCarrierStatus("teleported"), null);
  });
});

describe("single-parcel orders omit the label", () => {
  test("the subject carries no enumeration", () => {
    assert.equal(subjectFor("parcel-shipped-1-of-3", { orderRef: "AM-1", parcelLabel: null }), "Your order is on its way");
    assert.equal(
      subjectFor("parcel-shipped-1-of-3", { orderRef: "AM-1", parcelLabel: "Parcel 2 of 3" }),
      "Parcel 2 of 3 is on its way",
    );
  });

  test("the body carries none either, and leaves no stray separator", async () => {
    const html = await renderEmail("parcel-shipped-1-of-3", {
      orderRef: "AM-TEST",
      parcelLabel: null,
      items: [{ name: "Egusi", subtitle: "500g", lineTotal: "$8.50", quantityLine: "1 × $8.50" }],
    });
    assert.ok(!/Parcel \d+ of \d+/.test(html), "no enumeration anywhere in the body");
    assert.ok(!html.includes("{{"), "no unreplaced tokens");
    assert.ok(!/·\s*<\/p>/.test(html), "no separator left dangling where the label was");
  });

  test("a multi-parcel order keeps the label", async () => {
    const html = await renderEmail("parcel-shipped-2-of-3", {
      orderRef: "AM-TEST",
      parcelLabel: "Parcel 2 of 3",
      items: [{ name: "Egusi", subtitle: "500g", lineTotal: "$8.50", quantityLine: "1 × $8.50" }],
    });
    assert.ok(html.includes("Parcel 2 of 3"));
  });
});

describe("template rendering", () => {
  test("every item is rendered, not just the first", async () => {
    const items = [
      { name: "Egusi", subtitle: "500g", lineTotal: "$8.50", quantityLine: "1 × $8.50" },
      { name: "Garri", subtitle: "5kg", lineTotal: "$12.00", quantityLine: "1 × $12.00" },
      { name: "Ata Rodo", subtitle: "250g", lineTotal: "$6.75", quantityLine: "1 × $6.75" },
    ];
    const html = await renderEmail("delivered", { orderRef: "AM-TEST", items });
    for (const i of items) assert.ok(html.includes(i.name), `${i.name} missing from the email`);
  });

  test("order data is escaped before it reaches the HTML", async () => {
    const html = await renderEmail("delivered", {
      orderRef: "AM-TEST",
      items: [{ name: "<script>alert(1)</script>", subtitle: "x", lineTotal: "$1", quantityLine: "1" }],
    });
    assert.ok(!html.includes("<script>alert(1)</script>"), "unescaped markup reached the body");
    assert.ok(html.includes("&lt;script&gt;"));
  });

  test("the shipped template matches the parcel's position", () => {
    assert.equal(shippedTemplateFor(1, 3), "parcel-shipped-1-of-3");
    assert.equal(shippedTemplateFor(2, 3), "parcel-shipped-2-of-3");
    assert.equal(shippedTemplateFor(3, 3), "parcel-shipped-3-of-3");
    assert.equal(shippedTemplateFor(2, 5), "parcel-shipped-2-of-3", "middle parcels share a template");
    assert.equal(shippedTemplateFor(1, 1), "parcel-shipped-1-of-3", "single parcel, label suppressed separately");
  });
});

describe("outbox discipline", () => {
  test("notifications are queued through the transaction, never the global client", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./pipeline.ts", import.meta.url), "utf8");

    // Reading via the global client inside a transaction cannot see that
    // transaction's own writes — which silently dropped the confirmation
    // email the first time this pipeline ran.
    const queueFn = src.slice(src.indexOf("export async function queueOrderConfirmation"));
    const body = queueFn.slice(0, queueFn.indexOf("\n}"));
    assert.ok(!/\bprisma\.(order|shipment)\./.test(body), "queueOrderConfirmation must read through tx");
  });

  test("the sender interfaces exist so no provider is wired in", async () => {
    const { readFile } = await import("node:fs/promises");
    const src = await readFile(new URL("./senders.ts", import.meta.url), "utf8");
    for (const iface of ["EmailSender", "PushSender", "SmsSender"]) {
      assert.ok(src.includes(`interface ${iface}`), `${iface} missing`);
    }
    assert.ok(src.includes("readonly enabled = false"), "SMS must be off until 10DLC clears");
  });
});
