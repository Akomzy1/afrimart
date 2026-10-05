import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { resolveSession, type ResolvedSession } from "./auth/session.js";
import { roleHas, type Permission } from "./auth/permissions.js";

function bearerToken(req: CreateFastifyContextOptions["req"]): string | null {
  const header = req.headers.authorization;
  if (!header || Array.isArray(header)) return null;
  const [scheme, value] = header.split(" ");
  return scheme?.toLowerCase() === "bearer" && value ? value : null;
}

export async function createContext({ req }: CreateFastifyContextOptions) {
  // Resolved once per request. Null for every buyer and merchant call, which
  // is the common case — those surfaces never send a staff token.
  const staff = await resolveSession(bearerToken(req));
  return {
    req,
    staff,
    ip: req.ip,
    userAgent: typeof req.headers["user-agent"] === "string" ? req.headers["user-agent"] : undefined,
  };
}

export type Context = Awaited<ReturnType<typeof createContext>>;

const t = initTRPC.context<Context>().create();

export const router = t.router;
export const publicProcedure = t.procedure;

/**
 * Deny-by-default access control for the operations console.
 *
 * Every ops route must be built from `staffProcedure(permission)` and must
 * name the permission it needs. There is no "signed in is enough" variant on
 * purpose: the way an access-control hole usually appears is a new route
 * quietly defaulting to the weakest check available, so the weakest check does
 * not exist. A route that forgets its permission does not compile.
 *
 * Three gates, in order, each failing closed:
 *   1. a live session (not expired, not idled out, not revoked, not disabled)
 *   2. MFA satisfied for that session
 *   3. the role actually holds the permission
 */
export function staffProcedure(permission: Permission) {
  return t.procedure.use(async ({ ctx, next }) => {
    if (!ctx.staff) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to the operations console." });
    }
    if (!ctx.staff.mfaVerified) {
      throw new TRPCError({ code: "UNAUTHORIZED", message: "Second factor required." });
    }
    if (!roleHas(ctx.staff.role, permission)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Your role (${ctx.staff.role}) cannot ${permission}.`,
      });
    }
    return next({ ctx: { ...ctx, staff: ctx.staff as ResolvedSession } });
  });
}

/**
 * For the sign-in handshake only — the routes that establish a session and so
 * cannot require one. Kept separate from `publicProcedure` so it is obvious in
 * review that these are the only unauthenticated ops endpoints.
 */
export const staffAuthProcedure = t.procedure;
