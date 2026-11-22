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

## Current continuation point

The last pre-takeover commit, `e68b41b`, records [the seller onboarding and vision cataloguing plan](docs/plans/store-onboarding-and-vision-cataloguing.md), marked planned, not started. Phase 1 has substantial UI and backend logic, but is not ready for real orders.

| Area | Current implementation | Remaining work |
|---|---|---|
| Payments | Split/hold calculations, placeholder payment IDs, local refunds; an Express dashboard-link adapter exists | Stripe Connect onboarding, checkout collection, signed webhooks, transfers and real refunds |
| Shipping and tax | Local carrier quotes, basic address checks, estimated tax | EasyPost rates/labels/tracking and Stripe Tax |
| Seller onboarding | Staff-assisted and self-service registration, verified phones, private pending stores, invitations, kit records, private shelf capture, extraction and seller/staff catalogue review | Live provider evaluation and structured product-feed import |
| Cook and matching | Scripted recipe-to-cart; no Anthropic or Voyage connection | Model-backed assistance and canonical matching |
| Notifications | Outbox/templates, local email, in-memory push, configurable Twilio sender | Real email/push delivery and provisioned SMS service |
| Private photos | Local development storage and an S3-compatible adapter | Configure and verify the private bucket and signing secret for deployment |

Adding environment variables alone does not complete the missing integrations. Parts 1, 2a and 2b of the onboarding plan are implemented. Part 2c covers real-store evaluation and launch calibration. Keep Phase 2/3 work out of this pass.

Seller registration starts at `http://localhost:3001/onboarding`. Staff use the operations console's Onboarding tab to create a store, issue an invitation, record a kit and approve a seller. Set `NEXT_PUBLIC_MERCHANT_URL` in the ops app for invitation links when deploying. Self-service stores get a provisional active hub; staff confirm or change it before launch. Phone verification does not grant seller approval. The migration requires existing store sessions to sign in again so verification can be recorded; buyer and staff sessions are unchanged.

Sellers who choose filming can open shelf capture from registration or the merchant Camera tab. Each saved shelf survives a reload. Run `npm run e2e:shelves` with the backend and merchant app running to exercise capture and re-filming in Chrome with a synthetic camera.

Run `npm run e2e:catalogue` with the backend and merchant app running locally. The test uses recorded vision and embedding responses, a temporary seller, and Chrome. Finishing shelf capture queues the extraction job. The backend worker processes queued captures when `SHELF_EXTRACTION_ENABLED=yes`. Configure the two provider keys, model identifiers, per-token pricing in USD per million tokens, and the per-store daily budget in cents using the backend environment example. Restart the backend after changing these settings. Confirm permission to send private shelf images before enabling live reading.

Run `npm run verify:onboarding --workspace=@afrimart/backend` for database-backed registration and approval checks. With the backend, merchant app and ops app running and dev staff seeded, `npm run e2e:onboarding` clicks through both registration paths in Chrome. These checks use temporary stores and local SMS capture; immutable audit entries remain. Browser screenshots go to `tmp/onboarding-qa/`. For alternate ports, set `MERCHANT_URL` and `OPS_URL` when running the browser check and `NEXT_PUBLIC_MERCHANT_URL` on the ops app. `AFRIMART_NEXT_DIST_DIR=.next-onboarding` selects an isolated Next build directory for the merchant and ops dev servers.

Validation commands: `npm run typecheck`, `npm test`, and the database-backed `verify:*` scripts in `services/backend/package.json`. Unit tests do not establish that live provider integration works.
