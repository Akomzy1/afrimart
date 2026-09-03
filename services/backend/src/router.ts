import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { catalogueRouter } from "./routers/catalogue.js";

export const appRouter = router({
  health: healthRouter,
  catalogue: catalogueRouter,
});

export type AppRouter = typeof appRouter;
