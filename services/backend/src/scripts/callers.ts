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

export interface CallerOptions {
  staff?: ResolvedSession | null;
  /** "buyer:<id>" or "store:<id>": a session is issued and sent as a bearer token. */
  identity?: string;
  /** A bearer token as given, for trying one that is not a session. */
  rawToken?: string;
  /** A Cookie header, to exercise the cookie path the browsers use. */
  cookie?: string;
  /** The request's Origin; cookie-authenticated writes need an allowed one. */
  origin?: string;
  /** GET for a query. Anything else is a write, which is what the origin check is about. */
  method?: string;
  ip?: string;
  /** Collects every Set-Cookie value the procedures send, so a test can read the session they issued. */
  capture?: string[];
}

export function callerFor(opts: CallerOptions): Caller {
  return createCaller(async () => {
    const token = opts.rawToken ?? (opts.identity ? await tokenFor(opts.identity) : null);
    // A stand-in for the Fastify request and reply: only headers, address and set-cookie are used.
    const request = {
      method: opts.method ?? "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(opts.cookie ? { cookie: opts.cookie } : {}),
        ...(opts.origin ? { origin: opts.origin } : {}),
        "user-agent": "verify",
      },
      ip: opts.ip ?? "127.0.0.1",
    };
    const reply = {
      header(name: string, value: string) {
        if (name.toLowerCase() === "set-cookie") opts.capture?.push(value);
        return reply;
      },
    };
    const ctx = await createContext({ req: request, res: reply } as never);
    return { ...ctx, staff: opts.staff ?? ctx.staff };
  });
}

/** The session token inside a captured Set-Cookie for one kind of account (null if it was cleared or absent). */
export function cookieToken(captured: string[], kind: "buyer" | "store"): string | null {
  for (const c of [...captured].reverse()) {
    const m = new RegExp(`(?:__Host-)?afrimart_${kind}=([^;]*)`).exec(c);
    if (m) return m[1] ? m[1] : null;
  }
  return null;
}

/** An HTTP-style bearer token for an account, for scripts that call the running server. */
export const bearerFor = tokenFor;

/** Forget cached sessions (after revoking them in a test). */
export function forgetTokens() {
  tokens.clear();
}
