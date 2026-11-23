import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { PrismaClient } from "@prisma/client";
import { Browser } from "./cdp.js";
import type { PageReader } from "../../services/backend/src/catalogue/storefrontHttp.js";

const dbUrl = new URL(process.env.DATABASE_URL!);
assert.ok(["localhost", "127.0.0.1", "[::1]"].includes(dbUrl.hostname));
const adminDb = new PrismaClient();
const schema = "website_test_" + randomUUID().replaceAll("-", "");
await adminDb.$executeRawUnsafe('CREATE SCHEMA "' + schema + '"');
dbUrl.searchParams.set("schema", schema);
process.env.DATABASE_URL = dbUrl.href;
try {
  execFileSync(process.execPath, ["node_modules/prisma/build/index.js","migrate","deploy","--schema","services/backend/prisma/schema.prisma"], { stdio: "pipe" });
  console.log("Migrated the temporary PostgreSQL schema.");
  const { prisma } = await import("../../services/backend/src/db.js");
  const { buildServer } = await import("../../services/backend/src/app.js");
  const { issueUserSession } = await import("../../services/backend/src/auth/userSession.js");
  const { importWebsite } = await import("../../services/backend/src/catalogue/websiteImport.js");
  const website = "https://fixture.example/shop";
  const shopify = process.argv.includes("--shopify");
  const names = shopify ? ["Palm oil", "Palm oil"] : ["Ofada rice", "Palm oil"];
  const sizes = shopify ? ["500 ml", "1 L"] : ["1 kg", "500 ml"];
  const products = names.map((name,i) => ({ id: i+1, name, type: "simple",
    prices: { price: String(i ? 650 : 525), currency_code: "USD", currency_minor_unit: 2 },
    attributes: [{ name: "Pack size", terms: [{ name: sizes[i]! }] }] }));
  const fixture = createServer(async (req,res) => {
    const url = new URL(req.url!, website);
    if (url.pathname === "/shop") return res.end(shopify ? '<script>Shopify.shop = "fixture.myshopify.com";</script>' : '<link rel="https://api.w.org/" href="/wp-json/">');
    if (shopify && url.pathname === "/api/2026-10/graphql.json" && req.method === "POST") {
      let body = "";
      for await (const chunk of req) body += chunk;
      if (!JSON.parse(body).query.includes("query Catalogue")) return res.writeHead(400).end();
      const pageInfo = { hasNextPage: false, endCursor: null };
      const nodes = products.map((p,i) => ({ id: "gid://shopify/ProductVariant/" + p.id, title: sizes[i],
        selectedOptions: [{ name: "Size", value: sizes[i] }], price: { amount: (Number(p.prices.price) / 100).toFixed(2), currencyCode: "USD" } }));
      return res.end(JSON.stringify({ data: { products: { pageInfo, nodes: [{ id: "gid://shopify/Product/1", title: "Palm oil",
        vendor: "Fixture brand", variants: { pageInfo, nodes } }] } } }));
    }
    if (url.pathname === "/wp-json/wc/store/v1/products") {
      res.setHeader("x-wp-totalpages", "1");
      return res.end(JSON.stringify(products));
    }
    res.writeHead(404).end();
  });
  await new Promise<void>(resolve => fixture.listen(0, "127.0.0.1", resolve));
  const read: PageReader = async (url, signal, body) => {
    assert.equal(url.origin, shopify && body ? "https://fixture.myshopify.com" : new URL(website).origin);
    const origin = "http://127.0.0.1:" + (fixture.address() as AddressInfo).port;
    const res = await fetch(origin + url.pathname + url.search, { signal, method: body ? "POST" : "GET", body });
    return { url, status: res.status, body: await res.text(), pages: res.headers.get("x-wp-totalpages") ?? undefined };
  };
  const api = await buildServer({ logger: false, readStorefrontPage: read });
  let browser: Browser | undefined;
  try {
    await api.listen({ host: "127.0.0.1", port: 4000 });
    const hub = await prisma.hubMetro.create({ data: { name: "Test", state: "TX" } });
    const store = await prisma.store.create({ data: { name: "Fixture shop", ownerName: "Test merchant", sellerType: "store",
      hubMetroId: hub.id, ownerPhoneVerifiedAt: new Date(), onboardingProfileAt: new Date(), foodSafetyAttestedAt: new Date() } });
    for (const p of products) await prisma.canonicalProduct.create({ data: { canonicalName: p.name, packSize: p.attributes[0]!.terms[0]!.name,
      shortDescription: p.name, usedDescription: p.name, category: "Grocery", cuisine: "Nigerian", shippingWeightOz: 12, temperatureClass: "ambient", images: [] } });
    const token = await issueUserSession({ kind: "store", storeId: store.id }, {});
    console.log("Fixture store ready. Opening merchant onboarding in Chrome.");
    const b = browser = await Browser.launch({ width: 390, height: 844, mobile: true });
    await b.send("Network.setCookie", { name: "afrimart_store", value: token.token, url: "http://localhost:3001", httpOnly: true });
    await b.goto("http://localhost:3001/onboarding");
    await b.waitFor("document.body.innerText.includes('Connect your website')", "seller setup", 120000);
    await b.click("Connect your website");
    await b.type("#onb-site", website);
    await b.click("Save and continue");
    await b.waitFor("document.body.innerText.includes('Import website products')", "saved source");
    await b.click("Import website products");
    await b.waitFor("document.querySelectorAll('.mr-rtile').length === 2", "two imported drafts", 120000);
    assert.equal(await prisma.listing.count(), 0);
    const tile = (size: string) => "[...document.querySelectorAll('.mr-rtile')].find(t => t.textContent.includes(" + JSON.stringify(size) + "))";
    for (const p of products) {
      const scope = tile(p.attributes[0]!.terms[0]!.name);
      await b.click("Review item", "button", scope);
      await b.waitFor("document.body.innerText.includes('Imported from your website')", "website evidence");
      if (p.id === 1) await b.click("Increase price by 25 cents");
      await b.waitFor("[...document.querySelectorAll('button')].some(el => el.textContent==='Confirm item' && !el.disabled)", "publication checks");
      await b.click("Confirm item");
      await b.waitFor("(" + scope + ")?.innerText.includes('Confirmed')", "seller correction saved");
    }
    products[0]!.prices.price = "999";
    await b.click("Check website for new products");
    await b.waitFor("document.body.innerText.includes('No new products found.')", "repeat import");
    const concurrent = await Promise.all([importWebsite(store.id, read), importWebsite(store.id, read)]);
    assert.ok(concurrent.every(r => r.added === 0));
    assert.equal(await prisma.catalogueDraft.count(), 2);
    await b.click("Submit catalogue");
    await b.waitFor("document.body.innerText.includes('Catalogue submitted.')", "submitted catalogue");
    assert.deepEqual(await importWebsite(store.id, read), { added: 0 });
    const listings = await prisma.listing.findMany({ orderBy: { priceCents: "asc" }, include: { canonicalProduct: true } });
    assert.deepEqual(listings.map(l => [l.canonicalProduct.canonicalName,l.canonicalProduct.packSize,l.priceCents]),
      [[names[0],sizes[0],550],[names[1],sizes[1],650]]);
    assert.equal(await b.overflow(), 0);
    console.log("PASS", shopify ? "Shopify variants" : "WooCommerce products", "reviewed and re-imported, $5.50 and $6.50 verified in PostgreSQL");
  } finally {
    await browser?.close();
    await api.close();
    await new Promise<void>(resolve => fixture.close(() => resolve()));
    await prisma.$disconnect();
  }
} finally {
  await adminDb.$executeRawUnsafe('DROP SCHEMA "' + schema + '" CASCADE');
  await adminDb.$disconnect();
}
