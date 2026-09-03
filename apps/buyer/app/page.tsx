import { HomeHeader } from "../components/HomeHeader";
import { Hero } from "../components/Hero";
import { HomeSearchBar } from "../components/HomeSearchBar";
import { CuisineGrid } from "../components/CuisineGrid";
import { HowItWorks } from "../components/HowItWorks";
import { FeaturedStaples } from "../components/FeaturedStaples";
import { PromoBanner } from "../components/PromoBanner";
import { SellerInviteBanner } from "../components/SellerInviteBanner";
import { Logo } from "@afrimart/ui";

/** AfriMart Buyer App.html's Home tab — the only fully-designed tab in that prototype file. */
export default function Home() {
  return (
    <>
      <HomeHeader />
      <Hero />
      <HomeSearchBar />
      <CuisineGrid />
      <HowItWorks />
      <FeaturedStaples />
      <PromoBanner />
      <SellerInviteBanner />
      <div style={{ textAlign: "center", padding: "34px 20px 26px" }}>
        <hr style={{ border: 0, borderTop: "1px solid var(--gold-line)", maxWidth: 60, margin: "0 auto 18px" }} />
        <Logo tone="on-light" size={22} />
        <p style={{ fontSize: 11, letterSpacing: "0.06em", color: "var(--ink-3)", marginTop: 8 }}>The market from home, delivered.</p>
      </div>
      <div style={{ height: 22 }} />
    </>
  );
}
