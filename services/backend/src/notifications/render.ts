import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

/**
 * Email rendering against the prototype templates.
 *
 * A deliberately small substitution engine rather than a templating
 * dependency: the templates are fixed HTML from Claude Design with four
 * token shapes between them, and a library would be more surface than the
 * problem needs.
 *
 *   {{token}}            scalar substitution
 *   {{#items}}…{{/items}} repeated once per item
 *   {{parcelLabel}}      suppressed entirely for single-parcel orders
 */

const TEMPLATE_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), "templates");

export type TemplateName =
  | "order-confirmed"
  | "order-confirmed-no-chilled"
  | "parcel-shipped-1-of-3"
  | "parcel-shipped-2-of-3"
  | "parcel-shipped-3-of-3"
  | "delivered"
  | "chilled-parcel-delivered"
  | "refund-issued"
  | "report-received-item"
  | "report-received-parcel";

export interface EmailItem {
  name: string;
  subtitle: string;
  lineTotal: string;
  quantityLine: string;
}

export interface RenderContext {
  orderRef: string;
  /**
   * "Parcel 2 of 3", or null for a single-parcel order. Null removes the
   * label and the separators around it rather than leaving "Parcel 1 of 1",
   * which the prototype set deliberately has no template for.
   */
  parcelLabel?: string | null;
  carrier?: string;
  trackingNumber?: string;
  paymentMethod?: string;
  reportRef?: string;
  items?: EmailItem[];
}

const cache = new Map<string, string>();

async function load(name: TemplateName): Promise<string> {
  const cached = cache.get(name);
  if (cached) return cached;
  const html = await readFile(path.join(TEMPLATE_DIR, `${name}.html`), "utf8");
  cache.set(name, html);
  return html;
}

/** Escapes values before they land in HTML; order data is user-influenced. */
function esc(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function renderItems(html: string, items: EmailItem[]): string {
  return html.replace(/\{\{#items\}\}([\s\S]*?)\{\{\/items\}\}/g, (_full, unit: string) =>
    items
      .map((item) =>
        unit
          .replace(/\{\{name\}\}/g, esc(item.name))
          .replace(/\{\{subtitle\}\}/g, esc(item.subtitle))
          .replace(/\{\{lineTotal\}\}/g, esc(item.lineTotal))
          .replace(/\{\{quantityLine\}\}/g, esc(item.quantityLine)),
      )
      .join(""),
  );
}

/**
 * Removes the parcel label for single-parcel orders, including the separator
 * it sits beside. "Parcel 1 of 1" is never correct: with one parcel there is
 * nothing to enumerate.
 */
function stripParcelLabel(html: string): string {
  return html
    .replace(/\{\{parcelLabel\}\}\s*(&middot;|·)\s*/g, "")
    .replace(/\s*(&middot;|·)\s*\{\{parcelLabel\}\}/g, "")
    .replace(/\{\{parcelLabel\}\}\s+is on its way/g, "Your order is on its way")
    .replace(/\{\{parcelLabel\}\}/g, "");
}

export async function renderEmail(name: TemplateName, ctx: RenderContext): Promise<string> {
  let html = await load(name);

  html = renderItems(html, ctx.items ?? []);

  html = ctx.parcelLabel
    ? html.replace(/\{\{parcelLabel\}\}/g, esc(ctx.parcelLabel))
    : stripParcelLabel(html);

  for (const [key, value] of Object.entries({
    orderRef: ctx.orderRef,
    carrier: ctx.carrier ?? "",
    trackingNumber: ctx.trackingNumber ?? "",
    paymentMethod: ctx.paymentMethod ?? "",
    reportRef: ctx.reportRef ?? "",
  })) {
    html = html.replace(new RegExp(`\\{\\{${key}\\}\\}`, "g"), esc(value));
  }

  return html;
}

/**
 * Subject lines. Held here rather than parsed out of each template's <title>,
 * because the subject is a property of the notification and should not change
 * silently when a designer edits a page title.
 */
export function subjectFor(name: TemplateName, ctx: RenderContext & { refundAmount?: string }): string {
  switch (name) {
    case "order-confirmed":
    case "order-confirmed-no-chilled":
      return `Order confirmed: ${ctx.orderRef}`;
    case "delivered":
      return "Your order has arrived";
    case "chilled-parcel-delivered":
      // Deliberately urgent and specific: this one is time-sensitive in a way
      // no other delivery email is.
      return "Your chilled parcel was delivered — refrigerate it now";
    case "report-received-item":
    case "report-received-parcel":
      return "We have received your report";
    case "refund-issued":
      return `We've refunded ${ctx.refundAmount ?? "your order"} to your card`;
    default:
      // Single parcel: no enumeration, matching the body.
      return ctx.parcelLabel ? `${ctx.parcelLabel} is on its way` : "Your order is on its way";
  }
}

/** Which shipped template matches this parcel's position. */
export function shippedTemplateFor(index: number, total: number): TemplateName {
  if (total <= 1) return "parcel-shipped-1-of-3";
  if (index <= 1) return "parcel-shipped-1-of-3";
  if (index >= total) return "parcel-shipped-3-of-3";
  return "parcel-shipped-2-of-3";
}
