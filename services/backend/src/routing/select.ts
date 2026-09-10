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

/** A store can supply a line if it stocks it and any batch cap covers the quantity. */
export function canSupply(listing: CandidateListing, quantity: number): boolean {
  if (listing.stockStatus === "out_of_stock") return false;
  if (listing.batchQuantityCap !== null && quantity > listing.batchQuantityCap) return false;
  return true;
}

function candidatesFor(line: BasketLine, pool: CandidateListing[]): CandidateListing[] {
  return pool.filter((l) => l.canonicalProductId === line.canonicalProductId && canSupply(l, line.quantity));
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
  for (const line of lines) {
    (candidatesFor(line, pool).length ? fulfillable : unfulfillable).push(line);
  }

  const cheapestPossibleCents = fulfillable.reduce((sum, line) => {
    const best = cheapest(candidatesFor(line, pool));
    return sum + (best ? best.priceCents * line.quantity : 0);
  }, 0);

  if (!fulfillable.length) {
    return { assignment: [], unfulfillable, singleStore: false, cheapestPossibleCents: 0 };
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
    return { assignment: best, unfulfillable, singleStore: true, cheapestPossibleCents };
  }

  // CART-2, second clause: no single store can complete it, so spread — but
  // across as few stores as possible. Greedy set cover, breaking ties on price.
  const remaining = [...fulfillable];
  const assignment: AssignedLine[] = [];
  const chosenStores = new Set<string>();

  while (remaining.length) {
    const storeIds = new Set(remaining.flatMap((line) => candidatesFor(line, pool).map((l) => l.storeId)));
    let bestStore: string | null = null;
    let bestCovered = -1;
    let bestCost = Infinity;

    for (const storeId of storeIds) {
      const covered = remaining.filter((line) =>
        candidatesFor(line, pool).some((l) => l.storeId === storeId),
      );
      const cost = covered.reduce((sum, line) => {
        const best = cheapest(candidatesFor(line, pool).filter((l) => l.storeId === storeId))!;
        return sum + best.priceCents * line.quantity;
      }, 0);
      if (covered.length > bestCovered || (covered.length === bestCovered && cost < bestCost)) {
        bestStore = storeId;
        bestCovered = covered.length;
        bestCost = cost;
      }
    }

    if (!bestStore) break;
    chosenStores.add(bestStore);
    for (let i = remaining.length - 1; i >= 0; i--) {
      const line = remaining[i];
      const listing = cheapest(candidatesFor(line, pool).filter((l) => l.storeId === bestStore));
      if (listing) {
        assignment.push(assign(line, listing));
        remaining.splice(i, 1);
      }
    }
  }

  return { assignment, unfulfillable, singleStore: chosenStores.size === 1, cheapestPossibleCents };
}
