import { IP_WINDOW_MINUTES, MAX_ATTEMPTS_PER_IP } from "../config.js";

/**
 * Per-IP attempt ceiling for the sign-in endpoints.
 *
 * In-process and therefore per-instance: good enough for one backend, and
 * deliberately simple. The moment this runs on more than one instance it must
 * move to Redis or the database, because a limiter that each replica counts
 * separately multiplies the real ceiling by the replica count. Noted here
 * rather than discovered later.
 *
 * The per-account lockout in staffAuth.ts is the durable control; this exists
 * to blunt one address spraying a common password across many accounts, which
 * per-account counters never see.
 */
const hits = new Map<string, { count: number; resetAt: number }>();

export function tooManyFromIp(ip: string | undefined): boolean {
  if (!ip) return false;
  const now = Date.now();
  const entry = hits.get(ip);
  if (!entry || entry.resetAt <= now) {
    hits.set(ip, { count: 1, resetAt: now + IP_WINDOW_MINUTES * 60_000 });
    return false;
  }
  entry.count += 1;
  return entry.count > MAX_ATTEMPTS_PER_IP;
}

export function clearIp(ip: string | undefined): void {
  if (ip) hits.delete(ip);
}

/** Test seam: the limiter is process-global, so tests must be able to reset it. */
export function resetAllIpLimits(): void {
  hits.clear();
}
