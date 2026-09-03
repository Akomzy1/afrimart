import { Button, Logo } from "@afrimart/ui";

/**
 * Scaffold placeholder proving packages/ui renders correctly end-to-end.
 * The real three-tab shell (from AfriMart Merchant.html) is built in
 * Prompt 6, not here.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 430, margin: "0 auto", padding: 24 }}>
      <p className="eyebrow">Scaffold check</p>
      <div style={{ margin: "8px 0 24px" }}>
        <Logo tone="on-light" size={26} />
      </div>
      <Button variant="accent" style={{ width: "100%", justifyContent: "center", height: 64, fontSize: 20 }}>
        Accept order
      </Button>
    </main>
  );
}
