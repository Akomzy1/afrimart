import Link from "next/link";
import { Button, ArrowRightIcon } from "@afrimart/ui";

/** "Become a seller" invitation (AfriMart Buyer App.html). */
export function SellerInviteBanner() {
  return (
    <div className="container">
      <div className="home-seller">
        <div>
          <p className="eyebrow" style={{ color: "var(--ink-3)" }}>
            Become a seller
          </p>
          <h3 className="serif" style={{ fontSize: 23, lineHeight: 1.1, marginTop: 9, maxWidth: "18ch" }}>
            Own a store or cook from home? Sell on AfriMart.
          </h3>
          <p style={{ fontSize: "12.5px", color: "var(--ink-2)", marginTop: 7 }}>
            You stock the shelf, we handle the rest — payments, shipping and support.
          </p>
        </div>
        <Button as={Link} href="/account" variant="secondary" style={{ alignSelf: "flex-start" }}>
          Start selling <ArrowRightIcon />
        </Button>
      </div>
    </div>
  );
}
