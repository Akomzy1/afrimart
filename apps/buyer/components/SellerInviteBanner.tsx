import Link from "next/link";
import { Button, ArrowRightIcon } from "@afrimart/ui";

/** "Become a seller" invitation (AfriMart Buyer App.html). */
export function SellerInviteBanner() {
  return (
    <div
      style={{
        margin: "22px 20px 0",
        background: "var(--panel)",
        border: "1px solid var(--line)",
        borderRadius: "var(--r-lg)",
        padding: "24px 22px",
        display: "flex",
        flexDirection: "column",
        gap: 16,
      }}
    >
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
  );
}
