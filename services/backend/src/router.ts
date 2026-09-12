import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { catalogueRouter } from "./routers/catalogue.js";
import { checkoutRouter } from "./routers/checkout.js";
import { merchantRouter } from "./routers/merchant.js";

export const appRouter = router({
  health: healthRouter,
  catalogue: catalogueRouter,
  checkout: checkoutRouter,
  merchant: merchantRouter,
});

export type AppRouter = typeof appRouter;
