import type { KitchenLicenceStatus, Prisma, PrismaClient } from "@prisma/client";

/**
 * When a licensed-kitchen approval stops counting.
 *
 * An approval carries the expiry date the reviewer read off the licence. The
 * licence is valid through that day and not after it. The check is made by date
 * wherever the approval is read, never by a scheduled job: a job that has not
 * run yet, or ran and failed, would leave chilled listings live on a lapsed
 * licence, and "hidden exactly as on revocation" has to be true the moment the
 * date passes. Nothing is written when a licence lapses; the stored status stays
 * `approved`, and `licenceState` is how everything else learns it has expired.
 *
 * An approval with no expiry date is one recorded before the date was required;
 * it keeps counting, because inventing a lapse for it would hide a seller's
 * listings for something no one recorded.
 */

type Db = Prisma.TransactionClient | PrismaClient;

/** Midnight UTC on the day of `now`: the earliest expiry date that is still valid. */
export function startOfTodayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
}

export type LicenceState = KitchenLicenceStatus | "expired";

interface LicenceLike {
  status: KitchenLicenceStatus;
  licenceExpiresOn: Date | null;
}

/** What a licence is today: its stored status, or "expired" for an approval past its date. */
export function licenceState(licence: LicenceLike | null | undefined, now: Date = new Date()): LicenceState | null {
  if (!licence) return null;
  if (licence.status === "approved" && licence.licenceExpiresOn && licence.licenceExpiresOn.getTime() < startOfTodayUtc(now).getTime()) {
    return "expired";
  }
  return licence.status;
}

/** True when the seller currently holds licensed-kitchen status. */
export function licenceCounts(licence: LicenceLike | null | undefined, now: Date = new Date()): boolean {
  return licenceState(licence, now) === "approved";
}

/**
 * The same rule as a database filter, for listing queries: a licence that is
 * approved and either has no expiry date or has not passed it.
 */
export function currentLicenceWhere(today: Date = startOfTodayUtc()): Prisma.KitchenLicenceWhereInput {
  return { status: "approved", OR: [{ licenceExpiresOn: null }, { licenceExpiresOn: { gte: today } }] };
}

const day = (d: Date) => d.toLocaleDateString("en-US", { month: "long", day: "numeric", year: "numeric", timeZone: "UTC" });

/**
 * Tell a seller, once, in their AfriMart thread, that their licence has lapsed.
 * Called whenever the seller's app reads its thread or standing, so no job is
 * needed: the first read after the date passes posts it, and the key makes every
 * later read a no-op. A renewed licence that later lapses has a new expiry date
 * and so is a new notice.
 */
export async function ensureLicenceExpiryNotice(db: Db, storeId: string, now: Date = new Date()): Promise<void> {
  const licence = await db.kitchenLicence.findUnique({
    where: { storeId },
    select: { id: true, status: true, licenceExpiresOn: true },
  });
  if (!licence || licenceState(licence, now) !== "expired" || !licence.licenceExpiresOn) return;
  const expired = licence.licenceExpiresOn;
  const dedupeKey = `licence-expired:${licence.id}:${expired.toISOString().slice(0, 10)}`;
  await db.sellerMessage.upsert({
    where: { dedupeKey },
    update: {},
    create: {
      storeId,
      kind: "licence_expired",
      dedupeKey,
      body:
        `Your kitchen licence expired on ${day(expired)}, so your chilled and frozen listings are hidden from buyers. ` +
        "Send us your renewed licence here to bring them back.",
    },
  });
}
