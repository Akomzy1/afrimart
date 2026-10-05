import {
  QUALITY_MIN_ORDERS_FOR_ENFORCEMENT,
  QUALITY_WARNING_DEFECT_RATE,
  QUALITY_REDUCED_VISIBILITY_DEFECT_RATE,
  QUALITY_REVIEW_DEFECT_RATE,
} from "../config.js";

/**
 * QC-4 seller quality score and QC-6 enforcement ladder.
 *
 * Two rules shape this more than the arithmetic does.
 *
 * Only *confirmed* claims count. A submitted claim changes nothing until a
 * reviewer upholds it, because otherwise a single malicious buyer — or a run
 * of bad luck — damages an honest seller's livelihood before anyone has
 * looked. Claims recovered from the carrier never count against the seller
 * at all: the parcel left their hands intact.
 *
 * Nothing enforces below a minimum sample. One upheld complaint across three
 * orders is a 33% defect rate and means almost nothing; the same rate across
 * sixty orders is a real signal. Below the threshold the score is still
 * calculated and shown — operations should be able to see a new seller's
 * record — but it cannot drive automatic action.
 */

export interface SellerRecord {
  /** Orders delivered, the denominator for the defect rate. */
  deliveredOrders: number;
  /** Claims upheld on review AND recovered from this seller. */
  confirmedSellerClaims: number;
  /** Mean buyer rating, 1-5, or null when nobody has rated yet. */
  averageRating: number | null;
  ratingCount: number;
  /** Shipments accepted inside the window, over shipments offered. */
  onTimeAcceptanceRate: number | null;
}

export interface QualityScore {
  /** 0-100. Null when there is nothing to judge yet. */
  score: number | null;
  defectRate: number;
  sampleSize: number;
  /** False until the seller has enough orders for the score to mean anything. */
  enforceable: boolean;
  components: { ratings: number | null; defects: number; fulfilment: number | null };
}

export function computeScore(record: SellerRecord): QualityScore {
  const sampleSize = record.deliveredOrders;
  const defectRate = sampleSize > 0 ? record.confirmedSellerClaims / sampleSize : 0;

  const ratings = record.averageRating === null ? null : (record.averageRating / 5) * 100;
  const defects = Math.max(0, 100 - defectRate * 100 * 4); // a 25% defect rate zeroes it
  const fulfilment = record.onTimeAcceptanceRate === null ? null : record.onTimeAcceptanceRate * 100;

  const parts = [ratings, defects, fulfilment].filter((v): v is number => v !== null);
  const score = parts.length ? Math.round(parts.reduce((a, b) => a + b, 0) / parts.length) : null;

  return {
    score,
    defectRate,
    sampleSize,
    enforceable: sampleSize >= QUALITY_MIN_ORDERS_FOR_ENFORCEMENT,
    components: { ratings, defects, fulfilment },
  };
}

export type AutomaticAction = "none" | "warning" | "reduced_visibility" | "flag_for_review";

export interface LadderDecision {
  action: AutomaticAction;
  reason: string;
  /**
   * QC-6 — suspension and delisting are never automatic. When the record is
   * bad enough to justify one, this says so and routes it to a person rather
   * than taking the step itself.
   */
  requiresHumanDecision: boolean;
}

/**
 * QC-6 — what the system may do on its own.
 *
 * Warnings and reduced visibility are reversible and cost a seller
 * placement, not their business, so they can be automatic. Suspension and
 * delisting end someone's income and are frequently wrong on thin evidence,
 * so the ladder stops short and hands over.
 */
export function ladderFor(quality: QualityScore): LadderDecision {
  if (!quality.enforceable) {
    return {
      action: "none",
      reason: `Only ${quality.sampleSize} delivered orders — below the ${QUALITY_MIN_ORDERS_FOR_ENFORCEMENT} needed to act on a rate.`,
      requiresHumanDecision: false,
    };
  }

  const pct = (quality.defectRate * 100).toFixed(0);

  if (quality.defectRate >= QUALITY_REVIEW_DEFECT_RATE) {
    return {
      action: "flag_for_review",
      reason: `${pct}% confirmed defect rate over ${quality.sampleSize} orders — suspension or delisting is a human decision.`,
      requiresHumanDecision: true,
    };
  }
  if (quality.defectRate >= QUALITY_REDUCED_VISIBILITY_DEFECT_RATE) {
    return {
      action: "reduced_visibility",
      reason: `${pct}% confirmed defect rate over ${quality.sampleSize} orders.`,
      requiresHumanDecision: false,
    };
  }
  if (quality.defectRate >= QUALITY_WARNING_DEFECT_RATE) {
    return {
      action: "warning",
      reason: `${pct}% confirmed defect rate over ${quality.sampleSize} orders.`,
      requiresHumanDecision: false,
    };
  }
  return { action: "none", reason: `${pct}% confirmed defect rate — within tolerance.`, requiresHumanDecision: false };
}

/** QC-4 — the score drives search ranking. Unenforceable scores do not. */
export function visibilityMultiplierFor(quality: QualityScore, level: string | null): number {
  if (level === "suspended" || level === "delisted") return 0;
  if (level === "reduced_visibility") return 0.4;
  if (!quality.enforceable || quality.score === null) return 1; // new sellers are not penalised
  return quality.score >= 80 ? 1 : quality.score >= 60 ? 0.8 : 0.6;
}
