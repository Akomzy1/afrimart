import Link from "next/link";
import { Button, SealIcon, ArrowRightIcon } from "@afrimart/ui";

/**
 * "Taste of Home boxes" promo (AfriMart Buyer App.html). PRD SUB-1 tags
 * curated boxes as Phase 2 — this stays a teaser linking to /shop rather
 * than a real box catalogue, per CLAUDE.md phase discipline.
 */
export function PromoBanner() {
  return (
    <div style={{ margin: "38px 20px 0", background: "linear-gradient(155deg,#20402d,#183021)", borderRadius: "var(--r-lg)", padding: 2 }}>
      <div style={{ border: "1px solid rgba(203,171,114,.42)", borderRadius: 7, padding: "26px 24px", position: "relative", overflow: "hidden" }}>
        <span style={{ position: "absolute", right: -18, top: -14, color: "var(--gold-soft)", opacity: 0.28 }}>
          <SealIcon style={{ width: 130, height: 130 }} />
        </span>
        <p className="eyebrow" style={{ color: "var(--gold-soft)" }}>
          A curated gift
        </p>
        <h3 className="serif" style={{ color: "#f6efe2", fontSize: 27, lineHeight: 1.06, margin: "11px 0 9px", maxWidth: "15ch" }}>
          Taste of Home boxes
        </h3>
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
  );
}
