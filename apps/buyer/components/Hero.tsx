import Link from "next/link";
import { Button, ArrowRightIcon, LogoMark } from "@afrimart/ui";

/** AfriMart Buyer App.html hero — headline over a green/gold gradient field. */
export function Hero() {
  return (
    <section className="home-hero">
      <div className="home-hero-glyph">
        <LogoMark tone="on-dark" size={140} />
      </div>
      <div className="home-hero-inner container">
        <p className="eyebrow" style={{ color: "var(--gold-soft)" }}>
          The market from home
        </p>
        <h1 className="serif">The market from home, delivered anywhere in America</h1>
        <Button as={Link} href="/shop" variant="accent">
          Start shopping <ArrowRightIcon />
        </Button>
      </div>
    </section>
  );
}
