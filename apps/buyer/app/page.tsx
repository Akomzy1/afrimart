import { Button, ProductCard, ShippingProgress, Badge } from "@afrimart/ui";

/**
 * Scaffold placeholder proving packages/ui renders correctly end-to-end.
 * The real home screen (from AfriMart Buyer App.html) is built in Prompt 3,
 * not here.
 */
export default function Home() {
  return (
    <main style={{ maxWidth: 480, margin: "0 auto", padding: 24 }}>
      <p className="eyebrow">Scaffold check</p>
      <h1 className="serif" style={{ fontSize: 32, margin: "8px 0 24px" }}>
        Afri<span style={{ color: "var(--terra)" }}>Mart</span>
      </h1>

      <div style={{ display: "flex", gap: 12, marginBottom: 32, flexWrap: "wrap" }}>
        <Button variant="primary">Add to cart</Button>
        <Button variant="accent">Checkout securely</Button>
        <Button variant="secondary">Save for later</Button>
      </div>

      <div style={{ marginBottom: 32, maxWidth: 280 }}>
        <ProductCard
          name="Egusi"
          altNames="Ground melon seeds · 500g"
          sellerName="Adunni Foods"
          shippingNote="Ships in 1-2 days"
          priceLabel="$8.50"
          unitLabel="/ bag"
          flag={<Badge kind="fresh">Fresh</Badge>}
        />
      </div>

      <ShippingProgress subtotalCents={8600} thresholdCents={10000} />
    </main>
  );
}
