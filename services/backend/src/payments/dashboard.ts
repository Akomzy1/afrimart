import { assertDevOnlyAllowed } from "../runtime.js";

/**
 * The port through which a seller reaches their payout history.
 *
 * A seller's earnings are not shown on a screen of AfriMart's own: each payout
 * is posted to their AfriMart thread when it is made, and "See all payouts"
 * opens their Stripe Express dashboard, which already holds the full history,
 * bank details and statements. The link is made on request and returned, never
 * stored: Stripe's login links are single-use and expire within minutes, and a
 * stored one would be a stale link at best and a credential in the database at
 * worst.
 */

export interface PayoutDashboard {
  /** A fresh single-use link into the Express dashboard for this connected account. */
  loginLink(accountId: string): Promise<{ url: string }>;
}

/** Why a link could not be made, in words a seller can be shown. */
export class DashboardUnavailable extends Error {}

/**
 * Stripe Connect Express: `POST /v1/accounts/{id}/login_links`.
 *
 * Plain REST rather than the SDK, as with Twilio. Needs STRIPE_SECRET_KEY, and
 * only works for an Express account whose owner has finished Stripe's onboarding
 * (Stripe refuses otherwise, and that refusal is passed on as "not ready").
 * Not exercised against Stripe from this repo, since that needs live
 * credentials; the request follows Stripe's documented shape.
 */
export class StripePayoutDashboard implements PayoutDashboard {
  constructor(private readonly secretKey: string) {}

  async loginLink(accountId: string): Promise<{ url: string }> {
    if (!/^acct_[A-Za-z0-9]+$/.test(accountId)) throw new DashboardUnavailable("That payout account isn't valid.");
    const res = await fetch(`https://api.stripe.com/v1/accounts/${accountId}/login_links`, {
      method: "POST",
      headers: { authorization: `Bearer ${this.secretKey}` },
    });
    if (!res.ok) throw new DashboardUnavailable("Your payout account isn't ready to open yet.");
    const body = (await res.json()) as { url?: string };
    if (!body.url) throw new DashboardUnavailable("Your payout account isn't ready to open yet.");
    return { url: body.url };
  }
}

/**
 * Development stand-in: returns a link that goes nowhere useful. It refuses to
 * run anywhere that looks like production, where a seller would be sent to a
 * dead page and told it was their dashboard.
 */
export class LocalPayoutDashboard implements PayoutDashboard {
  async loginLink(accountId: string): Promise<{ url: string }> {
    assertDevOnlyAllowed();
    return { url: `https://example.com/stripe-express-dashboard-stand-in/${encodeURIComponent(accountId)}` };
  }
}

export function defaultPayoutDashboard(env: NodeJS.ProcessEnv = process.env): PayoutDashboard {
  return env.STRIPE_SECRET_KEY ? new StripePayoutDashboard(env.STRIPE_SECRET_KEY) : new LocalPayoutDashboard();
}

export let payoutDashboard: PayoutDashboard = defaultPayoutDashboard();

/** Test seam, and the swap point. */
export function setPayoutDashboard(next: PayoutDashboard): void {
  payoutDashboard = next;
}
