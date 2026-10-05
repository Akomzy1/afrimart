/**
 * Regenerates src/notifications/templates/ from docs/prototype/emails/.
 *
 * The prototype HTML is the spec, so the runtime templates are derived from
 * it by script rather than hand-edited: when a template is re-exported, this
 * is one command instead of a careful diff, and the transformation itself is
 * reviewable.
 *
 * What it does:
 *   - swaps the demo order and report references for tokens
 *   - turns "Parcel N of M" into {{parcelLabel}}, which the renderer omits
 *     entirely for a single-parcel order
 *   - turns the first item row of each item table into an {{#items}} block so
 *     real order lines repeat through it
 *
 * Run with: npm run build:emails --workspace=@afrimart/backend
 */
import { readdir, readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";

const SRC = path.resolve("../../docs/prototype/emails");
const DST = path.resolve("src/notifications/templates");

/** Scalar demo values, replaced wholesale. */
const SCALARS: [RegExp, string][] = [
  [/AM-4827-193|AM-4790-021|AM-4712-508/g, "{{orderRef}}"],
  [/AM-C-1987/g, "{{reportRef}}"],
  [/Visa ending 4821/g, "{{paymentMethod}}"],
  [/1Z 84V 2X0 03 1185 4471/g, "{{trackingNumber}}"],
  [/UPS Ground/g, "{{carrier}}"],
  [/Parcel \d of \d/g, "{{parcelLabel}}"],
];

/**
 * An item row is a <tr> containing a name, a muted subtitle, a line total and
 * a "qty × unit" line. Matching on that shape rather than on position keeps
 * the script working when the surrounding layout is re-exported.
 */
const ITEM_ROW =
  /<tr>\s*<td class="em-ln"[^>]*>\s*<p class="em-tx"[^>]*>([\s\S]*?)<\/p>\s*<p class="em-mu"[^>]*>([\s\S]*?)<\/p>\s*<\/td>\s*<td class="em-ln"[^>]*>\s*<p class="em-tx"[^>]*>([\s\S]*?)<\/p>\s*<p class="em-mu"[^>]*>([\s\S]*?)<\/p>\s*<\/td>\s*<\/tr>/g;

function templatiseItems(html: string): { html: string; rows: number } {
  const matches = [...html.matchAll(ITEM_ROW)];
  if (!matches.length) return { html, rows: 0 };

  // Keep the first row's exact markup as the repeating unit, with its four
  // text slots tokenised, then drop the remaining demo rows.
  const first = matches[0];
  const tokens = ["{{name}}", "{{subtitle}}", "{{lineTotal}}", "{{quantityLine}}"];
  // Splice by position, walking left to right: a captured value can also
  // appear elsewhere in the row, and replacing by text would corrupt it.
  let unit = "";
  let cursor = 0;
  for (let i = 1; i <= 4; i++) {
    const value = first[i];
    const at = first[0].indexOf(value, cursor);
    unit += first[0].slice(cursor, at) + tokens[i - 1];
    cursor = at + value.length;
  }
  unit += first[0].slice(cursor);

  let out = html.replace(first[0], `{{#items}}${unit}{{/items}}`);
  for (const m of matches.slice(1)) out = out.replace(m[0], "");
  return { html: out, rows: matches.length };
}

await mkdir(DST, { recursive: true });
const files = (await readdir(SRC)).filter((f) => f.endsWith(".html"));
const emptyTemplates: string[] = [];

for (const file of files) {
  let html = await readFile(path.join(SRC, file), "utf8");
  for (const [pattern, token] of SCALARS) html = html.replace(pattern, token);
  const { html: withItems, rows } = templatiseItems(html);
  await writeFile(path.join(DST, file), withItems);
  if (rows === 0) emptyTemplates.push(file);
  const tokens = new Set((withItems.match(/\{\{#?\/?([a-zA-Z]+)\}\}/g) ?? []).map((t) => t));
  console.log(`${file.padEnd(34)} ${rows} demo rows -> items block   tokens: ${[...tokens].join(" ")}`);
}
/**
 * Templates that legitimately carry no item list, and so are expected to
 * match zero rows. Listed explicitly rather than loosening the check: a
 * template losing its items is a silent failure worth catching, so a new
 * exception should be a deliberate edit here.
 *
 * report-received-parcel is parcel-level by design — the buyer is reporting
 * that a whole parcel never arrived, so it summarises the parcel rather than
 * enumerating what was in it.
 */
const NO_ITEMS_EXPECTED = new Set(["report-received-parcel.html"]);

const unexpectedlyEmpty = emptyTemplates.filter((f) => !NO_ITEMS_EXPECTED.has(f));

// A template with no matched rows would silently render no order lines at
// all, which is worse than failing: it looks fine until a real order ships.
if (unexpectedlyEmpty.length) {
  console.error(`\nNo item rows matched in: ${emptyTemplates.join(", ")}`);
  console.error("Real order lines would not render there. Fix ITEM_ROW rather than shipping it.");
  process.exit(1);
}

console.log(`\n${files.length} templates regenerated into ${DST}`);
