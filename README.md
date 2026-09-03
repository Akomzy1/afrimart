# AfriMart

The market from home, delivered. See `CLAUDE.md` for the full project brief, source-of-truth hierarchy, and build conventions before making changes.

## Structure

```
apps/buyer        buyer PWA (Next.js)
apps/merchant     merchant PWA (Next.js, mobile-only)
packages/ui       shared design system — tokens + components, built from docs/prototype
packages/shared   shared TypeScript types (Store, CanonicalProduct, Order, ...)
packages/api-client  shared typed tRPC client
services/backend  Fastify + tRPC API, Prisma/Postgres
```

## Getting started

```bash
npm install
cp services/backend/.env.example services/backend/.env   # fill in real keys
npm run db:generate --workspace=@afrimart/backend
npm run dev   # runs all apps + backend in parallel via turbo
```

- Buyer app: http://localhost:3000
- Merchant app: http://localhost:3001
- Backend: http://localhost:4000/trpc

Requires a running PostgreSQL instance matching `DATABASE_URL` in `services/backend/.env`.
