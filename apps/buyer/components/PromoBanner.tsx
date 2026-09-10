import Link from "next/link";
import { Button, SealIcon, ArrowRightIcon } from "@afrimart/ui";

/**
 * "Taste of Home boxes" promo (AfriMart Buyer App.html). PRD SUB-1 tags
 * curated boxes as Phase 2 — this stays a teaser linking to /shop rather
 * than a real box catalogue, per CLAUDE.md phase discipline.
 */
export function PromoBanner() {
  return (
    <div className="container">
      <div className="home-promo">
        <div className="home-promo-in">
          <span style={{ position: "absolute", right: -18, top: -14, color: "var(--gold-soft)", opacity: 0.28 }}>
            <SealIcon style={{ width: 130, height: 130 }} />
          </span>
          <p className="eyebrow" style={{ color: "var(--gold-soft)" }}>
            A curated gift
          </p>
          <h3 className="serif">Taste of Home boxes</h3>
          <p style={{ color: "#cbbfa8", fontSize: 13, lineHeight: 1.5, maxWidth: "34ch", marginBottom: 20 }}>
            A hand-picked selection of staples and treats, sealed and sent to someone you love.
          </p>
          <Button
            as={Link}
            href="/shop"
            variant="ghost"
            style={{ background: "transparent", border: "1.5px solid var(--gold-soft)", color: "#f6efe2" }}
          >
            Explore the boxes <ArrowRightIcon style={{ color: "var(--gold-soft)" }} />
          </Button>
        </div>
      </div>
    </div>
  );
}
