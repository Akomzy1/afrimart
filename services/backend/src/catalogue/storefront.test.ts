import assert from "node:assert/strict";
import test from "node:test";
import { readStorefront } from "./storefront.js";
import { publicAddress, readPublicPage } from "./storefrontHttp.js";

const site = "https://fixture.example/store/";
const shopPage = '<script>var Shopify = {}; Shopify.shop = "fixture.myshopify.com";</script>';
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

test("Shopify follows both cursors and preserves variant identity, pack size and currency", async () => {
  const last = { hasNextPage: false, endCursor: null };
  const variant = (id: number, value: string, currencyCode = "USD") => ({
    id: "gid://shopify/ProductVariant/" + id, title: value, selectedOptions: [{ name: "Size", value }],
    price: { amount: "6.50", currencyCode },
  });
  const requests: string[] = [];
  const rows = await readStorefront(site, async (url, _signal, body) => {
    if (url.href === site) return { url, status: 200, body: shopPage };
    assert.equal(url.href, "https://fixture.myshopify.com/api/2026-10/graphql.json");
    const { query, variables } = JSON.parse(body!);
    requests.push(variables.after ?? "first");
    let data;
    if (query.includes("query MoreVariants")) {
      assert.deepEqual(variables, { id: "p1", after: "v2" });
      data = { product: { variants: { pageInfo: last, nodes: [variant(12, "1 L", "CAD")] } } };
    } else if (variables.after === "p2") {
      data = { products: { pageInfo: last, nodes: [{ id: "p2", title: "Rice", vendor: "",
        variants: { pageInfo: last, nodes: [variant(13, "1 kg")] } }] } };
    } else {
      data = { products: { pageInfo: { hasNextPage: true, endCursor: "p2" }, nodes: [{ id: "p1", title: "Oil", vendor: "Test",
        variants: { pageInfo: { hasNextPage: true, endCursor: "v2" }, nodes: [variant(11, "500 ml")] } }] } };
    }
    return { url, status: 200, body: JSON.stringify({ data }) };
  });
  assert.deepEqual(requests, ["first", "v2", "p2"]);
  assert.deepEqual(rows.map(p => [p.sourceKey, p.reading.name, p.reading.packSize, p.reading.priceCents]),
    [["gid://shopify/ProductVariant/11", "Oil", "500 ml", 650], ["gid://shopify/ProductVariant/12", "Oil", "1 L", null],
      ["gid://shopify/ProductVariant/13", "Rice", "1 kg", 650]]);
});

test("a repeat import keeps the source of existing Shopify and page-markup drafts", async () => {
  const home = shopPage + '<script type="application/ld+json">{"@type":"Product","name":"Oil","sku":"A"}</script>';
  const offline = async (url: URL) => ({ url, status: url.href === site ? 200 : 403, body: home });
  const [fallback] = await readStorefront(site, offline);
  const [legacy] = await readStorefront(site, async url => {
    assert.equal(url.href, site);
    return offline(url);
  }, fallback!.sourceKey);
  assert.equal(legacy!.sourceKey, fallback!.sourceKey);
  await assert.rejects(readStorefront(site, offline, "gid://shopify/ProductVariant/1"), /feed is unavailable/);
});

test("Shopify rejects partial GraphQL results and non-advancing pagination", async () => {
  const payload = { data: { products: { nodes: [], pageInfo: { hasNextPage: true, endCursor: "same" } } } };
  for (const response of [payload, { ...payload, errors: [{ message: "partial data" }] }]) {
    await assert.rejects(readStorefront(site, async url => ({
      url, status: 200, body: url.href === site ? shopPage : JSON.stringify(response),
    })), /incomplete catalogue/);
  }
});

test("a saved Shopify domain still identifies the feed after a custom-domain redirect", async () => {
  let queried = false;
  await assert.rejects(readStorefront("https://fixture.myshopify.com/", async (url, _signal, body) => {
    if (!body) return { url: new URL(site), status: 200, body: "<p>Fixture shop</p>" };
    queried = true;
    assert.equal(url.hostname, "fixture.myshopify.com");
    return { url, status: 503, body: "" };
  }), /Shopify catalogue could not be loaded/);
  assert.equal(queried, true);
});
