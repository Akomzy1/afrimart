import { z } from "zod";
import type { PageReader } from "./storefrontHttp.js";

export const shopifyVariantPrefix = "gid://shopify/ProductVariant/";
const pageInfo = z.object({ hasNextPage: z.boolean(), endCursor: z.string().nullable() });
const variants = z.object({
  pageInfo,
  nodes: z.array(z.object({
    id: z.string().regex(/^gid:\/\/shopify\/ProductVariant\/\d+$/),
    title: z.string().trim().min(1), selectedOptions: z.array(z.object({ name: z.string(), value: z.string() })),
    price: z.object({ amount: z.string(), currencyCode: z.string() }),
  })),
});
const products = z.object({
  pageInfo, nodes: z.array(z.object({ id: z.string(), title: z.string().trim().min(1), vendor: z.string(), variants })),
});
const variantFields = `pageInfo { hasNextPage endCursor }
  nodes { id title selectedOptions { name value } price { amount currencyCode } }`;
const catalogueQuery = `query Catalogue($after: String) {
  products(first: 16, after: $after) { pageInfo { hasNextPage endCursor }
    nodes { id title vendor variants(first: 8) { ${variantFields} } } }
}`;
const variantsQuery = `query MoreVariants($id: ID!, $after: String!) {
  product(id: $id) { variants(first: 100, after: $after) { ${variantFields} } }
}`;
function nextPage(info: z.infer<typeof pageInfo>, seen: Set<string>) {
  if (!info.hasNextPage) return null;
  if (!info.endCursor || seen.has(info.endCursor)) throw Error("Shopify returned an incomplete catalogue page.");
  seen.add(info.endCursor);
  return info.endCursor;
}

export async function* shopifyVariants(shop: URL, read: PageReader, signal: AbortSignal) {
  const endpoint = new URL("/api/2026-10/graphql.json", shop);
  async function query<T>(document: string, variables: Record<string, string | null>, schema: z.ZodType<T>, first = false) {
    const page = await read(endpoint, signal, JSON.stringify({ query: document, variables }));
    if (first && [401, 403, 404].includes(page.status)) return null;
    if (page.status !== 200) throw Error("The Shopify catalogue could not be loaded. Try again.");
    const response = z.object({ data: schema, errors: z.array(z.unknown()).max(0).optional() }).safeParse(JSON.parse(page.body));
    if (!response.success || !response.data.data) throw Error("Shopify returned an incomplete catalogue. Try again.");
    return response.data.data;
  }
  const productCursors = new Set<string>();
  let after: string | null = null;
  do {
    const data = await query(catalogueQuery, { after }, z.object({ products }), after === null);
    if (!data) return;
    for (const product of data.products.nodes) {
      const variantCursors = new Set<string>();
      let batch = product.variants;
      for (;;) {
        for (const variant of batch.nodes) yield { title: product.title, vendor: product.vendor, variant };
        const cursor = nextPage(batch.pageInfo, variantCursors);
        if (!cursor) break;
        const more = await query(variantsQuery, { id: product.id, after: cursor }, z.object({ product: z.object({ variants }) }));
        if (!more) throw Error("Shopify returned an incomplete variant list.");
        batch = more.product.variants;
      }
    }
    after = nextPage(data.products.pageInfo, productCursors);
  } while (after);
}
