import Link from "next/link";
import { Button, ArrowRightIcon, LogoMark } from "@afrimart/ui";

/** AfriMart Buyer App.html hero — headline over a green/gold gradient field. */
export function Hero() {
  return (
    <section
      style={{
        position: "relative",
        padding: "40px 20px 44px",
        background: "linear-gradient(160deg, #2c5940 0%, #1f3d2b 46%, #183021 100%)",
        overflow: "hidden",
      }}
    >
      <div style={{ position: "absolute", right: -24, top: 20, opacity: 0.34 }}>
        <LogoMark tone="on-dark" size={140} />
      </div>
      <div style={{ position: "relative" }}>
        <p className="eyebrow" style={{ color: "var(--gold-soft)" }}>
          The market from home
        </p>
        <h1
          className="serif"
          style={{
            color: "#f6efe2",
            fontSize: 36,
            lineHeight: 1.05,
            fontWeight: 500,
            letterSpacing: "-0.02em",
            margin: "12px 0 22px",
            maxWidth: "12ch",
          }}
        >
          The market from home, delivered anywhere in America
        </h1>
        <Button as={Link} href="/shop" variant="accent">
          Start shopping <ArrowRightIcon />
        </Button>
      </div>
    </section>
  );
}
