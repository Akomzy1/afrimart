import { router } from "./trpc.js";
import { healthRouter } from "./routers/health.js";
import { catalogueRouter } from "./routers/catalogue.js";
import { checkoutRouter } from "./routers/checkout.js";
import { merchantRouter } from "./routers/merchant.js";
import { ordersRouter } from "./routers/orders.js";
import { claimsRouter } from "./routers/claims.js";
import { adminRouter } from "./routers/admin.js";
import { staffAuthRouter } from "./routers/staffAuth.js";
import { userAuthRouter } from "./routers/userAuth.js";

export const appRouter = router({
  userAuth: userAuthRouter,
  health: healthRouter,
  catalogue: catalogueRouter,
  checkout: checkoutRouter,
  merchant: merchantRouter,
  orders: ordersRouter,
  claims: claimsRouter,
  admin: adminRouter,
  staffAuth: staffAuthRouter,
});

export type AppRouter = typeof appRouter;
