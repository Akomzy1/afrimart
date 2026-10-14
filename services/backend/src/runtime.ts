/**
 * Is this a development machine?
 *
 * A few things in the backend are stand-ins that are harmless against a local
 * database and wrong anywhere else: a refund issuer that records a refund but
 * returns no money, a sender that writes a sign-in code to a file instead of
 * delivering it. Each refuses to run on anything that looks like production,
 * by the same three tests, so none of them can be left switched on by accident.
 * The staff seed script applies the same tests.
 */

/** Thrown when a development-only stand-in is asked to run somewhere it must not. Never caught into a success. */
export class DevOnlyRefused extends Error {
  constructor(readonly reasons: string[]) {
    super(`This development-only stand-in is disabled here: ${reasons.join("; ")}`);
  }
}

const LOCAL_HOSTS = ["localhost", "127.0.0.1", "::1", "host.docker.internal", "postgres", "db"];

/**
 * Why this environment looks like production, or an empty list if it does not.
 * Takes the environment as an argument so the rule can be tested without
 * touching process.env.
 *
 * The override is deliberately awkward to type: it exists for a staging box
 * that is neither local nor production, and a short truthy value must not work.
 */
export function productionSignals(env: NodeJS.ProcessEnv = process.env): string[] {
  if (env.ALLOW_DEV_ONLY_STAND_INS === "yes-run-the-stand-ins-here") return [];

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
export function assertDevOnlyAllowed(env: NodeJS.ProcessEnv = process.env): void {
  const reasons = productionSignals(env);
  if (reasons.length) throw new DevOnlyRefused(reasons);
}

/** True on a development machine. For choosing a default, never for granting access. */
export function isDevelopment(env: NodeJS.ProcessEnv = process.env): boolean {
  return productionSignals(env).length === 0;
}
