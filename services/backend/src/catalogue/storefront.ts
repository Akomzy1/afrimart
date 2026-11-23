import { createHash } from "node:crypto";
import { parse, parseFragment, type DefaultTreeAdapterTypes } from "parse5";
import { z } from "zod";
import type { Seen } from "./extraction.js";
import { readPublicPage, type PageReader } from "./storefrontHttp.js";
import { shopifyVariantPrefix, shopifyVariants } from "./shopify.js";

const limit = 500;
type ProductRow = { sourceKey: string; reading: Seen };
type HtmlNode = DefaultTreeAdapterTypes.Node;
function *elements(root: HtmlNode): Generator<DefaultTreeAdapterTypes.Element> {
  const stack = [root];
  while (stack.length) {
    const node = stack.pop()!;
    if ("tagName" in node) yield node;
    if ("childNodes" in node) for (let i = node.childNodes.length - 1; i >= 0; i--) stack.push(node.childNodes[i]!);
  }
}
function field(value: unknown) { return typeof value === "string" && value.trim() ? value.trim().slice(0, 300) : null; }
function record(value: unknown): value is Record<string, unknown> { return !!value && typeof value === "object" && !Array.isArray(value); }
function cents(value: unknown) {
  const price = typeof value === "number" || typeof value === "string" ? String(value) : "";
  if (!/^\d{1,6}(?:\.\d{1,2})?$/.test(price)) return null;
  const amount = Math.round(Number(price) * 100);
  return amount > 0 && amount <= 10_000_000 ? amount : null;
}
function row(id: string, name: string, brand: string | null, size: string | null, priceCents: number | null): ProductRow {
  const packSize = size ?? name.match(/\b\d+(?:\.\d+)?\s*(?:kg|ml|g|l|oz|lb)\b/i)?.[0] ?? null;
  const sourceKey = id.startsWith(shopifyVariantPrefix) ? id : createHash("sha256").update(id).digest("hex");
  return { sourceKey, reading: {
    name, rawText: name, brand, packSize, priceCents, frameNames: [], confidence: 1 } };
}
const wooProduct = z.object({
  id: z.number().int().positive(), name: z.string().trim().min(1).max(300), type: z.string().optional(),
  prices: z.object({ currency_code: z.string(), currency_minor_unit: z.number().int(), price: z.string(), price_range: z.unknown().optional() }),
  brands: z.array(z.object({ name: z.string() })).optional(),
  attributes: z.array(z.object({ name: z.string(), terms: z.array(z.object({ name: z.string() })) })).optional(),
});
function wooRow(p: z.infer<typeof wooProduct>) {
  const prices = p.prices;
  const price = prices.currency_code === "USD" && prices.currency_minor_unit === 2 && !prices.price_range && p.type !== "variable" &&
    /^\d+$/.test(prices.price) ? cents(Number(prices.price) / 100) : null;
  const sizes = p.attributes?.find(a => /^(size|weight|pack size)$/i.test(a.name))?.terms;
  const title = parseFragment(p.name).childNodes.map(n => n.nodeName === "#text" && "value" in n ? n.value : "").join("").trim();
  return row("woo:" + p.id, title || p.name, field(p.brands?.[0]?.name), sizes?.length === 1 ? field(sizes[0]!.name) : null, price);
}

function markupRows(value: unknown, rows: ProductRow[]) {
  const queue: unknown[] = [value];
  while (queue.length) {
    const item = queue.pop();
    if (Array.isArray(item)) { for (const entry of item) queue.push(entry); continue; }
    if (!record(item)) continue;
    const types = Array.isArray(item["@type"]) ? item["@type"] : [item["@type"]];
    const name = field(item.name);
    if (types.some(t => t === "Product" || t === "https://schema.org/Product") && name) {
      const brand = field(record(item.brand) ? item.brand.name : item.brand);
      const size = field(item.size);
      const offers = Array.isArray(item.offers) ? item.offers : [item.offers];
      const prices = offers.map(o => record(o) && o.priceCurrency === "USD" ? cents(o.price) : null);
      const id = field(item.sku) ?? field(item["@id"]) ?? field(item.url) ?? JSON.stringify([name, brand, size]);
      rows.push(row("markup:" + id, name, brand, size, prices.every(p => p === prices[0]) ? prices[0] ?? null : null));
      if (rows.length > limit) throw Error("This catalogue exceeds the 500-product import limit.");
    }
    for (const child of Object.values(item)) if (child && typeof child === "object") queue.push(child);
  }
}

export async function readStorefront(website: string, read: PageReader = readPublicPage, existingSourceKey?: string | null) {
  const signal = AbortSignal.timeout(30_000);
  const saved = new URL(website);
  const home = await read(saved, signal);
  if (home.status !== 200) throw Error("The saved storefront page could not be opened.");
  const scripts: string[] = [];
  const useShopify = existingSourceKey ? existingSourceKey.startsWith(shopifyVariantPrefix) : undefined;
  const shopHost = [home.url.hostname, saved.hostname].find(host => /^[a-z0-9][a-z0-9-]*\.myshopify\.com$/i.test(host));
  let shop = shopHost ? new URL("https://" + shopHost) : undefined;
  let woo = false, apiRoot = new URL("/wp-json/", home.url);
  for (const el of elements(parse(home.body))) {
    const attr = (name: string) => el.attrs.find(a => a.name === name)?.value ?? "";
    if (el.tagName === "script" && !attr("src") && useShopify !== false) {
      const script = el.childNodes.find(n => n.nodeName === "#text");
      const domain = script && "value" in script && /\bShopify\.shop\s*=\s*["']([a-z0-9][a-z0-9-]*\.myshopify\.com)["']/i.exec(script.value);
      if (domain) shop = new URL("https://" + domain[1]);
    }
    if (el.tagName === "link" && attr("rel") === "https://api.w.org/") {
      const href = new URL(attr("href"), home.url);
      if (href.origin === home.url.origin) { apiRoot = href; woo = true; }
    }
    if ((el.tagName === "body" && /woocommerce/i.test(attr("class"))) ||
      ((el.tagName === "script" || el.tagName === "link") && (attr("src") + attr("href")).includes("/plugins/woocommerce/"))) woo = true;
    if (el.tagName === "script" && attr("type").toLowerCase().trim() === "application/ld+json") {
      const script = el.childNodes.find(n => n.nodeName === "#text");
      if (script && "value" in script) scripts.push(script.value);
    }
  }
  const rows = new Map<string, ProductRow>();
  if (useShopify !== false && shop) {
    for await (const { title, vendor, variant } of shopifyVariants(shop, read, signal)) {
      const sizeOption = variant.selectedOptions.find(o => /^(size|weight|volume|pack size)$/i.test(o.name));
      const otherOptions = variant.selectedOptions.filter(o => o !== sizeOption && o.value !== "Default Title");
      const name = [title, ...otherOptions.map(o => o.value)].join(" · ");
      const product = row(variant.id, field(name)!, field(vendor), field(sizeOption?.value),
        variant.price.currencyCode === "USD" ? cents(variant.price.amount) : null);
      product.reading.rawText = field(variant.title === "Default Title" ? title : title + " · " + variant.title)!;
      rows.set(variant.id, product);
      if (rows.size > limit) throw Error("This catalogue exceeds the 500-variant import limit.");
    }
  }
  if (useShopify && !rows.size) throw Error("Your Shopify variant feed is unavailable. Try again.");
  if (!rows.size && woo) {
    const url = new URL(apiRoot);
    if (url.searchParams.has("rest_route")) url.searchParams.set("rest_route", "/wc/store/v1/products");
    else url.pathname = url.pathname.replace(/\/?$/, "/wc/store/v1/products");
    url.searchParams.set("per_page", "100");
    url.searchParams.set("orderby", "id");
    url.searchParams.set("order", "asc");
    for (let page = 1; page <= 6; page++) {
      url.searchParams.set("page", String(page));
      const result = await read(url, signal);
      if (page === 1 && result.status === 404) break;
      if (result.status !== 200) throw Error("The store product feed could not be loaded. Try again.");
      const parsed = z.array(wooProduct).max(100).safeParse(JSON.parse(result.body));
      if (!parsed.success) throw Error("The store returned an unsupported product feed.");
      for (const p of parsed.data) { const product = wooRow(p); rows.set(product.sourceKey, product); }
      if (rows.size > limit || (page === 6 && parsed.data.length)) throw Error("This catalogue exceeds the 500-product import limit.");
      const totalPages = Number(result.pages);
      if (Number.isInteger(totalPages) && totalPages > 0) {
        if (totalPages > Math.ceil(limit / 100)) throw Error("This catalogue exceeds the 500-product import limit.");
        if (page >= totalPages) break;
      } else if (parsed.data.length < 100) break;
    }
  }
  if (!rows.size) {
    const markup: ProductRow[] = [];
    for (const script of scripts) {
      let value: unknown;
      try { value = JSON.parse(script); } catch { continue; }
      markupRows(value, markup);
    }
    for (const product of markup) rows.set(product.sourceKey, product);
  }
  if (!rows.size) throw Error("No supported products found. Use a Shopify or WooCommerce storefront, or a page with structured product details.");
  return [...rows.values()];
}
