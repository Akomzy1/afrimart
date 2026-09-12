import { REQUIRE_VERIFIED_ALL } from "../config.js";
import type { AssignedLine, BasketLine, CandidateListing } from "./types.js";

/**
 * CART-2 — single-store-preferring store selection.
 *
 * The requirement is stricter than "prefer one store": it says spread across
 * stores *only when no single store can complete the basket*. So a feasible
 * single-store solution always wins, even when a split would be cheaper — the
 * "accepting a modest price difference" clause is the PRD explaining why, not a
 * condition to test. We therefore do not cap the premium; we measure it and
 * hand it back on the plan so operations can see when the policy is costing
 * real money. Capping it here would contradict the written rule.
 */

/**
 * SEL-2 / SEL-4 — may this seller receive a routed order at all?
 *
 * SEL-2's literal scope is non-store sellers: verification is required "before
 * a non-store seller can list to the public". REQUIRE_VERIFIED_ALL extends that
 * to every seller type, which is the default — routing an order to an
 * unverified seller is precisely the moment the trust gate is meant to bite,
 * and SEL-4 wants unproven sellers held back rather than handed volume.
 */
export function isEligibleSeller(listing: CandidateListing): boolean {
  const verified = listing.verificationStatus === "verified";
  if (verified) return true;
  if (REQUIRE_VERIFIED_ALL) return false;
  return listing.sellerType === "store";
}

/** A store can supply a line if it stocks it and any batch cap covers the quantity. */
export function canSupply(listing: CandidateListing, quantity: number): boolean {
  if (listing.stockStatus === "out_of_stock") return false;
  if (listing.batchQuantityCap !== null && quantity > listing.batchQuantityCap) return false;
  return true;
}

function candidatesFor(line: BasketLine, pool: CandidateListing[]): CandidateListing[] {
  return pool.filter(
    (l) => l.canonicalProductId === line.canonicalProductId && canSupply(l, line.quantity) && isEligibleSeller(l),
  );
}

/** Stocked and in quantity, but behind the trust gate. */
function blockedCandidatesFor(line: BasketLine, pool: CandidateListing[]): CandidateListing[] {
  return pool.filter(
    (l) => l.canonicalProductId === line.canonicalProductId && canSupply(l, line.quantity) && !isEligibleSeller(l),
  );
}

function cheapest(listings: CandidateListing[]): CandidateListing | null {
  if (!listings.length) return null;
  return listings.reduce((a, b) => (b.priceCents < a.priceCents ? b : a));
}

function assign(line: BasketLine, listing: CandidateListing): AssignedLine {
  return {
    canonicalProductId: line.canonicalProductId,
    quantity: line.quantity,
    listing,
    lineTotalCents: listing.priceCents * line.quantity,
  };
}

export interface Selection {
  assignment: AssignedLine[];
  unfulfillable: BasketLine[];
  /** Stocked, but only by a seller the trust gate excludes. */
  blockedByVerification: BasketLine[];
  singleStore: boolean;
  /** Cost of buying every line at its cheapest offer, ignoring store count. */
  cheapestPossibleCents: number;
}

/**
 * Returns every store that can supply *all* fulfillable lines on its own.
 * Empty means no single-store solution exists and we must split.
 */
export function storesAbleToCompleteAll(lines: BasketLine[], pool: CandidateListing[]): string[] {
  const perLineStores = lines.map((line) => new Set(candidatesFor(line, pool).map((l) => l.storeId)));
  if (!perLineStores.length) return [];
  const [first, ...rest] = perLineStores;
  return [...first].filter((storeId) => rest.every((s) => s.has(storeId)));
}

export function selectStores(lines: BasketLine[], pool: CandidateListing[]): Selection {
  const fulfillable: BasketLine[] = [];
  const unfulfillable: BasketLine[] = [];
  const blockedByVerification: BasketLine[] = [];
  for (const line of lines) {
    if (candidatesFor(line, pool).length) fulfillable.push(line);
    else if (blockedCandidatesFor(line, pool).length) blockedByVerification.push(line);
    else unfulfillable.push(line);
  }

  const cheapestPossibleCents = fulfillable.reduce((sum, line) => {
    const best = cheapest(candidatesFor(line, pool));
    return sum + (best ? best.priceCents * line.quantity : 0);
  }, 0);

  if (!fulfillable.length) {
    return { assignment: [], unfulfillable, blockedByVerification, singleStore: false, cheapestPossibleCents: 0 };
  }

  // CART-2, first clause: one store for everything, if any store can do it.
  const capableStores = storesAbleToCompleteAll(fulfillable, pool);
  if (capableStores.length) {
    const solutions = capableStores.map((storeId) =>
      fulfillable.map((line) => {
        const listing = cheapest(candidatesFor(line, pool).filter((l) => l.storeId === storeId))!;
        return assign(line, listing);
      }),
    );
    const best = solutions.reduce((a, b) =>
      b.reduce((s, l) => s + l.lineTotalCents, 0) < a.reduce((s, l) => s + l.lineTotalCents, 0) ? b : a,
    );
    return { assignment: best, unfulfillable, blockedByVerification, singleStore: true, cheapestPossibleCents };
  }

  // CART-2, second clause: no single store can complete it, so spread — across
  // as few stores as possible.
  //
  // This searches for the true minimum rather than taking greedy's first
  // answer. Greedy picks whichever store covers the most lines and can settle
  // for three stores where two would do, and every extra store is another
  // parcel the platform pays to ship. Baskets are small, so an exact search
  // over store subsets is affordable; `minimumStoreCover` falls back to greedy
  // if a basket is ever broad enough to make it not be.
  const bestStores = minimumStoreCover(fulfillable, pool);
  const assignment = fulfillable.map((line) => {
    const listing = cheapest(candidatesFor(line, pool).filter((l) => bestStores.has(l.storeId)))!;
    return assign(line, listing);
  });

  return { assignment, unfulfillable, blockedByVerification, singleStore: bestStores.size === 1, cheapestPossibleCents };
}

/**
 * Smallest set of stores covering every line; among equally small sets, the
 * cheapest. Exhaustive by subset size, so it returns a proven minimum.
 */
function minimumStoreCover(lines: BasketLine[], pool: CandidateListing[]): Set<string> {
  const storeIds = [...new Set(lines.flatMap((line) => candidatesFor(line, pool).map((l) => l.storeId)))];

  const covers = (chosen: string[]): boolean =>
    lines.every((line) => candidatesFor(line, pool).some((l) => chosen.includes(l.storeId)));

  const costOf = (chosen: string[]): number =>
    lines.reduce((sum, line) => {
      const best = cheapest(candidatesFor(line, pool).filter((l) => chosen.includes(l.storeId)));
      return sum + (best ? best.priceCents * line.quantity : 0);
    }, 0);

  // Guard against combinatorial blow-up on an unusually broad basket.
  const EXHAUSTIVE_STORE_LIMIT = 14;
  if (storeIds.length > EXHAUSTIVE_STORE_LIMIT) return greedyCover(lines, pool, storeIds);

  for (let size = 1; size <= storeIds.length; size++) {
    let best: string[] | null = null;
    let bestCost = Infinity;
    for (const combo of combinations(storeIds, size)) {
      if (!covers(combo)) continue;
      const cost = costOf(combo);
      if (cost < bestCost) {
        best = combo;
        bestCost = cost;
      }
    }
    if (best) return new Set(best);
  }
  return greedyCover(lines, pool, storeIds);
}

function* combinations(items: string[], size: number): Generator<string[]> {
  if (size === 0) {
    yield [];
    return;
  }
  for (let i = 0; i <= items.length - size; i++) {
    for (const rest of combinations(items.slice(i + 1), size - 1)) {
      yield [items[i], ...rest];
    }
  }
}

/** Fallback for baskets too broad to search exhaustively. */
function greedyCover(lines: BasketLine[], pool: CandidateListing[], storeIds: string[]): Set<string> {
  const chosen = new Set<string>();
  const remaining = [...lines];
  while (remaining.length) {
    let bestStore: string | null = null;
    let bestCovered = 0;
    for (const storeId of storeIds) {
      const covered = remaining.filter((line) =>
        candidatesFor(line, pool).some((l) => l.storeId === storeId),
      ).length;
      if (covered > bestCovered) {
        bestStore = storeId;
        bestCovered = covered;
      }
    }
    if (!bestStore) break;
    chosen.add(bestStore);
    for (let i = remaining.length - 1; i >= 0; i--) {
      if (candidatesFor(remaining[i], pool).some((l) => l.storeId === bestStore)) remaining.splice(i, 1);
    }
  }
  return chosen;
}
