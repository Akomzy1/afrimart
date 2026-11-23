import assert from "node:assert/strict";
import test from "node:test";
import { readStorefront } from "./storefront.js";
import { publicAddress, readPublicPage } from "./storefrontHttp.js";

const site = "https://fixture.example/store/";
const product = (id: number, currency = "USD") => ({
  id, name: "Rice &amp; beans 1 kg", prices: { price: "499", currency_code: currency, currency_minor_unit: 2 },
});

test("WooCommerce reads the advertised API root, follows pagination and deduplicates product IDs", async () => {
  const requests: string[] = [];
  const rows = await readStorefront(site, async url => {
    if (url.href === site) return { url, status: 200, body: '<link rel="https://api.w.org/" href="/store/wp-json/">' };
    assert.equal(url.pathname, "/store/wp-json/wc/store/v1/products");
    const page = url.searchParams.get("page")!;
    requests.push(page);
    const items = page === "1" ? [product(1)] : [product(1), product(2, "CAD"), { ...product(3), type: "variable" }];
    return { url, status: 200, pages: "2", body: JSON.stringify(items) };
  });
  assert.deepEqual(requests, ["1", "2"]);
  assert.deepEqual(rows.map(p => p.reading.priceCents), [499, null, null]);
  assert.equal(rows[0]!.reading.name, "Rice & beans 1 kg");
  assert.equal(rows[0]!.reading.packSize, "1 kg");
});

test("Product JSON-LD uses a stable SKU and leaves conflicting prices for review", async () => {
  const load = (price: string, second: string) => readStorefront(site, async url => ({
    url, status: 200, body: '<script type="application/ld+json">' + JSON.stringify({ "@graph": [
      { "@type": "Product", sku: "a", name: "Palm oil", brand: { name: "Farm" }, size: "500 ml",
        offers: [price, second].map(p => ({ price: p, priceCurrency: "USD" })) },
    ] }) + "</script>",
  }));
  const [first] = await load("5.25", "5.25");
  const [second] = await load("5.50", "6.50");
  assert.equal(first!.reading.priceCents, 525);
  assert.equal(second!.reading.priceCents, null);
  assert.equal(second!.reading.brand, "Farm");
  assert.equal(first!.sourceKey, second!.sourceKey);
});

test("an unreadable feed fails before returning a partial catalogue", async () => {
  await assert.rejects(readStorefront(site, async url => {
    if (url.href === site) return { url, status: 200, body: '<body class="woocommerce">' };
    if (url.searchParams.get("page") === "1") return { url, status: 200, pages: "2", body: JSON.stringify([product(1)]) };
    return { url, status: 503, body: "" };
  }), /feed could not be loaded/);
  await assert.rejects(readStorefront(site, async url => ({ url, status: 200, body: "<p>Welcome</p>" })), /No supported products/);
});

test("the public reader rejects local network destinations before connecting", async () => {
  for (const address of ["127.0.0.1", "10.0.0.1", "169.254.0.1", "192.168.1.1", "::1", "::ffff:127.0.0.1", "fd00::1"]) {
    assert.equal(publicAddress(address), false);
  }
  assert.equal(publicAddress("1.1.1.1"), true);
  await assert.rejects(readPublicPage(new URL("http://127.0.0.1/"), AbortSignal.timeout(500)), /publicly accessible/);
});
