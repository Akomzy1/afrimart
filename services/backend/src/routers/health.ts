import { publicProcedure, router } from "../trpc.js";

export const healthRouter = router({
  ping: publicProcedure.query(() => ({ status: "ok", time: new Date().toISOString() })),
});
