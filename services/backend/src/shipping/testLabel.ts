import { createHash } from "node:crypto";
import { PDFDocument, StandardFonts, grayscale } from "pdf-lib";
import { assertDevOnlyAllowed } from "../runtime.js";

export type LabelPaper = "4x6" | "letter";

/** The same 4 × 6 inch label is placed at actual size on either sheet. */
export async function testLabelPdf(parcel: { id: string; orderId: string }, paper: LabelPaper) {
  assertDevOnlyAllowed();
  const doc = await PDFDocument.create({ updateMetadata: false });
  doc.setTitle("AfriMart test label");
  const regular = await doc.embedFont(StandardFonts.Helvetica);
  const bold = await doc.embedFont(StandardFonts.HelveticaBold);
  const page = doc.addPage(paper === "letter" ? [612, 792] : [288, 432]);
  const left = (page.getWidth() - 288) / 2;
  const bottom = (page.getHeight() - 432) / 2;
  const line = (y: number) => page.drawLine({
    start: { x: left + 16, y: bottom + y }, end: { x: left + 272, y: bottom + y },
    thickness: 0.75, color: grayscale(0.5),
  });
  const text = (value: string, y: number, size: number, strong = false) =>
    page.drawText(value, { x: left + 18, y: bottom + y, size, font: strong ? bold : regular });

  page.drawRectangle({ x: left + 1, y: bottom + 1, width: 286, height: 430, borderWidth: 1, borderColor: grayscale(0.2) });
  text("AfriMart", 392, 20, true);
  text("TEST LABEL", 344, 33, true);
  text("Printer check only. No postage.", 321, 13);
  line(302);
  text("SAMPLE SENDER", 277, 10, true);
  text("AfriMart training store", 252, 16);
  text("SAMPLE RECIPIENT", 208, 10, true);
  text("AfriMart receiving desk", 183, 16);
  line(158);
  const orderRef = parcel.orderId.slice(-4).toUpperCase().replace(/[^A-Z0-9_-]/g, "?");
  const parcelRef = createHash("sha256").update(parcel.id).digest("hex").slice(0, 16).toUpperCase();
  text(`Order #${orderRef}`, 130, 14, true);
  text(`Parcel ${parcelRef}`, 108, 13);
  line(76);
  text("DO NOT SHIP", 44, 19, true);
  text("Print at actual size (100%).", 22, 11);
  return Buffer.from(await doc.save());
}
