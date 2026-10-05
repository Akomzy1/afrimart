import type { StaffRole } from "@prisma/client";

/**
 * Role-based access for the operations console.
 *
 * Deny-by-default: a permission a role is not granted here is denied, and
 * `staffProcedure` requires every ops route to name the permission it needs.
 * There is no "authenticated is enough" path — adding a route without a
 * permission is a type error, not a silent hole.
 *
 * The load-bearing separation is that `catalogue_reviewer` holds no `finance:*`
 * and no `stores:write`. A reviewer resolving a queue all day must not be able
 * to release a payout or change a seller's standing, both because that is not
 * their job and because it keeps the audit trail meaningful.
 */
export const PERMISSIONS = [
  /** Held by every role: identify yourself and see which tabs apply. */
  "console:access",
  "catalogue:read",
  "catalogue:write",
  "graph:read",
  "graph:write",
  "stores:read",
  "stores:write",
  "fulfilment:read",
  "fulfilment:write",
  "finance:read",
  "finance:write",
  "staff:manage",
  "audit:read",
] as const;

export type Permission = (typeof PERMISSIONS)[number];

const ROLE_PERMISSIONS: Record<StaffRole, readonly Permission[]> = {
  // Resolves the CAT-6 queue. Reads the graph to pick a canonical product,
  // but cannot reshape it, touch a seller's standing, or see money.
  catalogue_reviewer: ["console:access", "catalogue:read", "catalogue:write", "graph:read"],

  // Runs onboarding and fulfilment. Can suspend or delist a seller, which is
  // audited. Reads finance to chase a problem but cannot move money.
  operations: [
    "console:access",
    "catalogue:read",
    "graph:read",
    "graph:write",
    "stores:read",
    "stores:write",
    "fulfilment:read",
    "fulfilment:write",
    "finance:read",
    "audit:read",
  ],

  // Payouts, holds, chargebacks and refund recovery. Deliberately cannot
  // approve catalogue or change onboarding state.
  finance: ["console:access", "stores:read", "fulfilment:read", "finance:read", "finance:write", "audit:read"],

  admin: [...PERMISSIONS],
};

export function roleHas(role: StaffRole, permission: Permission): boolean {
  return ROLE_PERMISSIONS[role].includes(permission);
}

export function permissionsFor(role: StaffRole): readonly Permission[] {
  return ROLE_PERMISSIONS[role];
}
