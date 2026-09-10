import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { catalogueRouter } from "./routers/catalogue.js";
import { checkoutRouter } from "./routers/checkout.js";

export const appRouter = router({
  health: healthRouter,
  catalogue: catalogueRouter,
  checkout: checkoutRouter,
});

export type AppRouter = typeof appRouter;
