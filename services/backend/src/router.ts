import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { catalogueRouter } from "./routers/catalogue.js";
import { checkoutRouter } from "./routers/checkout.js";
import { merchantRouter } from "./routers/merchant.js";
import { adminRouter } from "./routers/admin.js";
import { staffAuthRouter } from "./routers/staffAuth.js";

export const appRouter = router({
  health: healthRouter,
  catalogue: catalogueRouter,
  checkout: checkoutRouter,
  merchant: merchantRouter,
  admin: adminRouter,
  staffAuth: staffAuthRouter,
});

export type AppRouter = typeof appRouter;
