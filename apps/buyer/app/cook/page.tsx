import { StubView, CookPotIcon } from "@afrimart/ui";

/** Matches AfriMart Buyer App.html's own v-cook stub — the real Cook agent is Prompt 4. */
export default function CookPage() {
  return (
    <StubView
      icon={<CookPotIcon />}
      title="Cook"
      description="Tell us the dish, we'll fill your cart. The recipe agent is a faster option — the full shop is always one tap away."
    />
  );
}
