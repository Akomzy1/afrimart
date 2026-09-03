import { z } from "zod";
import { prisma } from "../db.js";
import { publicProcedure, router } from "../trpc.js";

/**
 * PRD 6.3/6.4 scaffold: CAT-1 (registry), SRCH-1 (multilingual/multi-spelling search).
 * This is a first pass — real entity resolution and knowledge-graph ranking (CAT-2, CAT-3)
 * land with the full catalogue build in Prompt 8, not here.
 */
const searchInput = z.object({ query: z.string().min(1) });

export const catalogueRouter = router({
  list: publicProcedure.query(() => prisma.canonicalProduct.findMany({ take: 50 })),

  search: publicProcedure.input(searchInput).query(({ input }: { input: z.infer<typeof searchInput> }) =>
    prisma.canonicalProduct.findMany({
      where: {
        OR: [
          { canonicalName: { contains: input.query, mode: "insensitive" } },
          { aliases: { some: { alias: { contains: input.query, mode: "insensitive" } } } },
        ],
      },
      take: 50,
    }),
  ),
});
