import { initTRPC, TRPCError } from "@trpc/server";
import type { CreateFastifyContextOptions } from "@trpc/server/adapters/fastify";
import { resolveSession, type ResolvedSession } from "./auth/session.js";
import { roleHas, type Permission } from "./auth/permissions.js";
import { DevIdentityRefused, assertDevIdentityAllowed, resolveIdentity, type IdentityKind } from "./identity.js";

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
export const createCallerFactory = t.createCallerFactory;
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

/* ------------------------------------------------- buyers and merchants */

/**
 * Resolve the caller as a buyer or a store from the request, never from input.
 * An unidentified caller is UNAUTHORIZED. A refusal from the dev stub (it is
 * running somewhere that looks like production) is a server fault, not a
 * credentials problem, and says nothing about why to the caller.
 */
async function identify(ctx: Context, kind: IdentityKind): Promise<string> {
  try {
    const id = await resolveIdentity(ctx.req.headers, kind);
    if (!id) throw new TRPCError({ code: "UNAUTHORIZED", message: "Sign in to continue." });
    return id;
  } catch (e) {
    if (e instanceof DevIdentityRefused) {
      ctx.req.log?.error({ reasons: e.reasons }, "dev identity refused: real sign-in is required here");
      throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Sign-in is not available in this environment." });
    }
    throw e;
  }
}

/** A buyer-facing procedure. `ctx.buyerId` is the only way a handler learns who is asking. */
export const buyerProcedure = t.procedure.use(async ({ ctx, next }) =>
  next({ ctx: { ...ctx, buyerId: await identify(ctx, "buyer") } }),
);

/** A merchant-facing procedure. `ctx.storeId` is the only way a handler learns whose shop this is. */
export const merchantProcedure = t.procedure.use(async ({ ctx, next }) =>
  next({ ctx: { ...ctx, storeId: await identify(ctx, "store") } }),
);

/**
 * For conveniences that exist only while there is no real sign-in (a list of
 * stores to pick from). Fails closed anywhere that looks like production, so
 * they cannot outlive the stub by accident.
 */
export const devProcedure = t.procedure.use(async ({ next }) => {
  try {
    assertDevIdentityAllowed();
  } catch (e) {
    if (e instanceof DevIdentityRefused) {
      throw new TRPCError({ code: "NOT_FOUND", message: "Not available." });
    }
    throw e;
  }
  return next();
});
