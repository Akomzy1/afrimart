import type { IncomingHttpHeaders } from "node:http";
import { prisma } from "./db.js";

/**
 * Who is making this request, for the two audiences that are not staff.
 *
 * Every buyer-facing and merchant-facing procedure resolves its caller here
 * and nowhere else, and no procedure takes a buyer or store id as input. An
 * endpoint that accepts "which store am I" from the caller is an endpoint any
 * visitor can point at someone else's orders, photos or payouts; resolving it
 * from the request makes that class of bug unwritable rather than reviewed.
 * `buyerProcedure` and `merchantProcedure` in trpc.ts are the only consumers.
 *
 * THIS IS A DEVELOPMENT STUB. It trusts a header the client sets itself, which
 * is fine for building against a local database and catastrophic anywhere
 * else, so it refuses to run on anything that looks like production — by the
 * same three tests, and with the same deliberately awkward override, as the
 * staff seed script. Real buyer and merchant sign-in replaces
 * `resolveIdentity`'s body and nothing else: its callers, and so every
 * endpoint built on it, do not change. That has to land before any deployment.
 */

export type IdentityKind = "buyer" | "store";

/** The header the dev stub reads: `buyer:<id>` or `store:<id>`. */
export const DEV_IDENTITY_HEADER = "x-dev-identity";

/** Thrown when the stub is asked to run somewhere it must not. Never caught into a success. */
export class DevIdentityRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(`Development identity is disabled here: ${reasons.join("; ")}`);
  }
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal", "postgres", "db"];

/**
 * Why this environment looks like production, or an empty list if it does not.
 * Takes the environment as an argument so the rule can be tested without
 * touching process.env.
 */
export function productionSignals(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.ALLOW_DEV_IDENTITY === "yes-trust-the-client-header") return [];

  const url = env.DATABASE_URL ?? "";
  const host = (() => {
    try {
      return new URL(url).hostname;
    } catch {
      return "";
    }
  })();

  const reasons: string[] = [];
  if (env.NODE_ENV === "production") reasons.push("NODE_ENV is production");
  if (host && !LOCAL_HOSTS.includes(host)) reasons.push(`database host "${host}" is not local`);
  // An underscore counts as a word character, so a plain word-boundary test would miss
  // afrimart_production; anything that is not a letter or digit separates words here.
  if (/(^|[^a-z0-9])(prod|production|live)([^a-z0-9]|$)/i.test(url)) reasons.push("DATABASE_URL names a production database");
  return reasons;
}

/** Throws unless this looks like a development machine. */
export function assertDevIdentityAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const reasons = productionSignals(env);
  if (reasons.length) throw new DevIdentityRefused(reasons);
}

/** `buyer:abc` -> "abc" when kind is "buyer"; anything else, including the wrong kind, is null. */
export function parseDevIdentity(header: string | string[] | undefined, kind: IdentityKind): string | null {
  if (typeof header !== "string") return null;
  const m = /^(buyer|store):([A-Za-z0-9_-]{1,64})$/.exec(header.trim());
  return m && m[1] === kind ? m[2]! : null;
}

interface IdentityDb {
  buyer: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> };
  store: { findUnique(args: { where: { id: string }; select: { id: true } }): Promise<{ id: string } | null> };
}

/**
 * The single resolver. Returns the caller's buyer or store id, or null when
 * they are not identified (which callers turn into UNAUTHORIZED). The id is
 * only returned if the row exists, so a made-up id gets nowhere.
 */
export async function resolveIdentity(
  headers: IncomingHttpHeaders,
  kind: IdentityKind,
  deps: { db?: IdentityDb; env?: NodeJS.ProcessEnv } = {},
): Promise<string | null> {
  assertDevIdentityAllowed(deps.env);

  const id = parseDevIdentity(headers[DEV_IDENTITY_HEADER], kind);
  if (!id) return null;

  const db = deps.db ?? (prisma as unknown as IdentityDb);
  const row =
    kind === "buyer"
      ? await db.buyer.findUnique({ where: { id }, select: { id: true } })
      : await db.store.findUnique({ where: { id }, select: { id: true } });
  return row?.id ?? null;
}
