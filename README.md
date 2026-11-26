# AfriMart

The market from home, delivered. See `CLAUDE.md` for the full project brief, source-of-truth hierarchy, and build conventions before making changes.

## Structure

```
apps/buyer        buyer PWA (Next.js)
apps/merchant     merchant PWA (Next.js, mobile-only)
apps/ops          internal operations console (Next.js)
packages/ui       shared design system â€” tokens + components, built from docs/prototype
packages/shared   shared TypeScript types (Store, CanonicalProduct, Order, ...)
packages/api-client  shared typed tRPC client
services/backend  Fastify + tRPC API, Prisma/Postgres
```

## Getting started

Use Node.js 20.12 or later. In Windows PowerShell, use `npm.cmd` if execution policy blocks `npm.ps1`.

```powershell
npm.cmd install
# Only create files that do not exist; preserve any existing credentials.
if (!(Test-Path services/backend/.env)) { Copy-Item services/backend/.env.example services/backend/.env }
foreach ($app in 'buyer', 'merchant', 'ops') {
  if (!(Test-Path "apps/$app/.env.local")) { Copy-Item "apps/$app/.env.example" "apps/$app/.env.local" }
}
npm.cmd run db:generate
npm.cmd run check:setup -- --database
```

Set `DATABASE_URL` in `services/backend/.env` to a running PostgreSQL database. For a **new local development database**, apply the existing migrations and seed the demo catalogue:

```powershell
npm.cmd exec --workspace=@afrimart/backend -- prisma migrate deploy
npm.cmd run seed --workspace=@afrimart/backend
npm.cmd run seed:dev-staff --workspace=@afrimart/backend
npm.cmd run dev
```

- Buyer app: http://localhost:3000
- Merchant app: http://localhost:3001
- Operations console: http://localhost:3002
- Backend: http://localhost:4000/trpc

Requires a running PostgreSQL instance matching `DATABASE_URL` in `services/backend/.env`.

`npm run check:setup` inventories configuration without printing values or contacting providers. Add `-- --database` to run a read-only `SELECT 1`; it does not migrate or seed the database. The checker reads backend `.env` and local-development app env files, with process variables taking precedence. Use literal values in these files; the checker does not expand `$VARIABLE` references.

For a local demo, provider keys can remain empty. Buyer sign-in emails are saved under `services/backend/.mail/`, and merchant sign-in texts under `services/backend/.sms/`. Real SMS is selected only when the Twilio settings are complete and `SMS_ENABLED=yes`. Keep all service secrets in the backend; app `NEXT_PUBLIC_*` values are public.

## Delivery-photo pilot

Run `npm run eval:deliveries` for six illustrated deliveries with scripted readings. The report shows each suggested listing and count. Its totals distinguish correct counts, incorrect counts, missed listings, and guesses on unreadable cartons.

For a live run, place the delivery photos and a manifest in `tmp/delivery-evaluation/`. Use the participating store's ID and its listing IDs. Label each visible listing once per photo with the total number of sellable packs. Use `null` when the photo does not establish the count.

```json
{"storeId":"STORE_ID","photos":[{"file":"delivery.jpg","expected":[{"listingId":"LISTING_ID","units":6}]}]}
```

From the repository root, run `node --env-file=services/backend/.env --import tsx tools/evaluation/deliveries.mts --dataset tmp/delivery-evaluation/manifest.json`. This uses the configured delivery vision model, charges its usage against the store's daily extraction budget, and scores suggestions before seller confirmation. The evaluator never calls the stock update operation.

## Current continuation point

The last pre-takeover commit, `e68b41b`, records [the seller onboarding and vision cataloguing plan](docs/plans/store-onboarding-and-vision-cataloguing.md), marked planned, not started. Phase 1 has substantial UI and backend logic, but is not ready for real orders.

| Area | Current implementation | Remaining work |
|---|---|---|
| Payments | Split/hold calculations, placeholder payment IDs, local refunds; an Express dashboard-link adapter exists | Stripe Connect onboarding, checkout collection, signed webhooks, transfers and real refunds |
| Shipping and tax | Local carrier quotes, basic address checks, estimated tax | EasyPost rates/labels/tracking and Stripe Tax |
| Seller onboarding | Registration, verified phones, invitations, kits, private shelf capture, extraction, Shopify, WooCommerce and Product JSON-LD import, and seller/staff catalogue review | Live shelf-extraction provider evaluation |
| Cook and matching | Scripted recipe-to-cart; no Anthropic or Voyage connection | Model-backed assistance and canonical matching |
| Notifications | Outbox/templates, local email, merchant browser push and verified-phone SMS fallback, configurable Twilio sender | Live email, production push keys and provisioned SMS service |
| Private photos | Local development storage and an S3-compatible adapter | Configure and verify the private bucket and signing secret for deployment |

Website import reads up to 500 Shopify variants, WooCommerce products, or Product JSON-LD entries from the saved storefront. For Shopify it reads the public Storefront API and creates one draft per variant. Sellers review each draft before submission and enter a USD price when the source price is ambiguous or uses another currency. Checking the website again adds newly identified products and preserves reviewed drafts. With local PostgreSQL configured and the merchant app running on port 3001, run `npm run e2e:website-import` for the WooCommerce browser fixture or `npm run e2e:website-import -- --shopify` for Shopify. Each check starts its own API on port 4000.

On November 23, 2026, a read-only pilot against TransAfrican Food Store’s public WooCommerce feed imported 108 distinct drafts from two pages into a temporary local PostgreSQL schema. A second import added zero drafts. Three sampled prices matched the merchant’s product pages. The pilot created zero listings and the temporary schema was removed. [TransAfrican Food Store](https://transafricanfoodstore.com/)

The Shopify connector passed the local two-variant browser test and a query against Shopify’s public demo API. Two public merchant storefronts returned HTTP 403 during the live check. Live variant prices and repeat imports still need verification with a participating Shopify merchant.

Adding environment variables alone does not complete the missing integrations. Parts 1, 2a and 2b of the onboarding plan are implemented. Part 2c covers real-store evaluation and launch calibration. Keep Phase 2/3 work out of this pass.

Seller registration starts at `http://localhost:3001/onboarding`. Staff use the operations console's Onboarding tab to create a store, issue an invitation, record a kit and approve a seller. Set `NEXT_PUBLIC_MERCHANT_URL` in the ops app for invitation links when deploying. Self-service stores get a provisional active hub; staff confirm or change it before launch. Phone verification does not grant seller approval. The migration requires existing store sessions to sign in again so verification can be recorded; buyer and staff sessions are unchanged.

Sellers who choose filming can open shelf capture from registration or the merchant Camera tab. Each saved shelf survives a reload. Run `npm run e2e:shelves` with the backend and merchant app running to exercise capture and re-filming in Chrome with a synthetic camera.

Run `npm run e2e:catalogue` with the backend and merchant app running locally. The test uses recorded vision and embedding responses, a temporary seller, and Chrome. Finishing shelf capture queues the extraction job. The backend worker processes queued captures when `SHELF_EXTRACTION_ENABLED=yes`. Configure the two provider keys, model identifiers, per-token pricing in USD per million tokens, and the per-store daily budget in cents using the backend environment example. Restart the backend after changing these settings. Confirm permission to send private shelf images before enabling live reading.

Run `npm run verify:onboarding --workspace=@afrimart/backend` for database-backed registration and approval checks. With the backend, merchant app and ops app running and dev staff seeded, `npm run e2e:onboarding` clicks through both registration paths in Chrome. These checks use temporary stores and local SMS capture; immutable audit entries remain. Browser screenshots go to `tmp/onboarding-qa/`. For alternate ports, set `MERCHANT_URL` and `OPS_URL` when running the browser check and `NEXT_PUBLIC_MERCHANT_URL` on the ops app. `AFRIMART_NEXT_DIST_DIR=.next-onboarding` selects an isolated Next build directory for the merchant and ops dev servers.

Validation commands: `npm run typecheck`, `npm test`, and the database-backed `verify:*` scripts in `services/backend/package.json`. Unit tests do not establish that live provider integration works.

Merchant order alerts queue one fallback text per store and order when push is unavailable or fails. The backend worker retries temporary SMS failures while a parcel still awaits the seller. Development texts go to the local SMS directory. Run `npm run verify:merchant-alerts --workspace=@afrimart/backend` against a migrated local database with a hub to exercise the fallback using test senders.

To enable browser push, apply the backend migrations and generate a stable signing pair with `npx web-push generate-vapid-keys`. Set `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY` and a contact URI in `VAPID_SUBJECT` in the backend environment. Restart the backend. On HTTPS or localhost, a signed-in seller can choose **Enable order alerts on this device** in Orders and grant notification permission. On iPhone, open the installed home-screen app first. Opt-out is per device. Signing out or letting the session expire stops new alerts for that session. Rotating the key pair requires sellers to reconnect their devices.
