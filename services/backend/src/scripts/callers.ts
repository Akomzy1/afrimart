import { createCallerFactory, createContext } from "../trpc.js";
import { appRouter } from "../router.js";
import { issueUserSession } from "../auth/userSession.js";
import type { ResolvedSession } from "../auth/session.js";

/**
 * Callers for the verify scripts that go through the real request path.
 *
 * Each call builds its context with `createContext`, the function the server
 * itself uses, from a request carrying a real session token in its
 * Authorization header. So these scripts exercise the same resolution a
 * browser's request gets (token -> session row -> buyer or store) instead of
 * handing the router a pre-made identity. `identity` is "buyer:<id>" or
 * "store:<id>" for a session to be issued for that account; `rawToken` is for
 * trying a token that is not one.
 */

const createCaller = createCallerFactory(appRouter);
const tokens = new Map<string, string>();

async function tokenFor(identity: string): Promise<string> {
  let token = tokens.get(identity);
  if (!token) {
    const [kind, id] = identity.split(":") as ["buyer" | "store", string];
    const issued = await issueUserSession(kind === "buyer" ? { kind, buyerId: id } : { kind, storeId: id }, { ip: "127.0.0.1", userAgent: "verify" });
    token = issued.token;
    tokens.set(identity, token);
  }
  return token;
}

type Caller = ReturnType<typeof createCaller>;

export function callerFor(opts: { staff?: ResolvedSession | null; identity?: string; rawToken?: string; ip?: string }): Caller {
  return createCaller(async () => {
    const token = opts.rawToken ?? (opts.identity ? await tokenFor(opts.identity) : null);
    // A stand-in for the Fastify request: only the headers and address are read.
    const request = { headers: { ...(token ? { authorization: `Bearer ${token}` } : {}), "user-agent": "verify" }, ip: opts.ip ?? "127.0.0.1" };
    const ctx = await createContext({ req: request, res: {} } as never);
    return { ...ctx, staff: opts.staff ?? ctx.staff };
  });
}

/** An HTTP-style bearer token for an account, for scripts that call the running server. */
export const bearerFor = tokenFor;

/** Forget cached sessions (after revoking them in a test). */
export function forgetTokens() {
  tokens.clear();
}
