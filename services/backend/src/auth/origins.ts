/**
 * Which browser origins may call this API with a buyer's or a shop's cookie.
 *
 * One list, used twice: it is what CORS answers to (so a page from any other
 * origin cannot read a response), and it is what a cookie-authenticated write
 * is checked against (so a page from any other origin cannot make a signed-in
 * visitor's browser change something, even where SameSite would let the cookie
 * ride along, such as between two subdomains of the same site).
 *
 * The local apps are always allowed in development. Anywhere else the allowed
 * origins are named, exactly, in CORS_ORIGINS (comma-separated, no wildcards).
 */

const LOCAL = /^http:\/\/localhost:\d+$/;

export function allowedOriginList(env: NodeJS.ProcessEnv = process.env): string[] {
  return (env.CORS_ORIGINS ?? "")
    .split(",")
    .map((o) => o.trim().replace(/\/+$/, ""))
    .filter(Boolean);
}

/** What @fastify/cors is given. Localhost is always allowed: nothing off this machine can be there. */
export function corsOrigins(env: NodeJS.ProcessEnv = process.env): (string | RegExp)[] {
  return [LOCAL, ...allowedOriginList(env)];
}

export function isAllowedOrigin(origin: string | string[] | undefined, env: NodeJS.ProcessEnv = process.env): boolean {
  if (typeof origin !== "string" || !origin) return false;
  return LOCAL.test(origin) || allowedOriginList(env).includes(origin.replace(/\/+$/, ""));
}
