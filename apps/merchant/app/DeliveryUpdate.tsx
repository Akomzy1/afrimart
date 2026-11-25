"use client";

import { useState } from "react";
import { trpc } from "@afrimart/api-client";
import { ChevronLeftIcon } from "@afrimart/ui";
import { PhotoCamera } from "./PhotoCamera";

type Row = { key: string; label: string; listingId: string; units: string; opening: string };
const newRow = (): Row => ({ key: crypto.randomUUID(), label: "", listingId: "", units: "", opening: "" });
const whole = (text: string, min: number, max: number) =>
  /^\d+$/.test(text) && Number.isSafeInteger(Number(text)) && Number(text) >= min && Number(text) <= max;

export function DeliveryUpdate({ onBack }: { onBack: () => void }) {
  const listings = trpc.merchant.listings.useQuery();
  const utils = trpc.useUtils();
  const preview = trpc.merchant.previewDelivery.useMutation();
  const save = trpc.merchant.receiveDelivery.useMutation({
    onSuccess: () => { void utils.merchant.listings.invalidate(); },
    onError: () => { void utils.merchant.listings.invalidate(); },
  });
  const [pendingReceipt, setPendingReceipt] = useState<Parameters<typeof save.mutate>[0] | null>(null);
  const uncertain = Boolean(save.isError && pendingReceipt && (!save.error.data || save.error.data.code === "INTERNAL_SERVER_ERROR"));
  const locked = save.isPending || uncertain;
  const [photo, setPhoto] = useState("");
  const [requestId, setRequestId] = useState("");
  const [rows, setRows] = useState<Row[]>([]);
  const [hint, setHint] = useState("");
  const products = listings.data ?? [];
  function update(key: string, change: Partial<Row>) {
    setRows(old => old.map(row => row.key === key ? { ...row, ...change } : row));
  }
  function read(image: string) {
    preview.mutate({ image }, { onSuccess: result => {
      setRequestId(crypto.randomUUID());
      setPhoto(image);
      setRows(result.rows.length ? result.rows.map(r => ({ ...newRow(), listingId: r.listingId ?? "",
        label: [r.name, r.packSize].filter(Boolean).join(" · "), units: r.units?.toString() ?? "" })) : [newRow()]);
      setHint(!result.available ? "Automatic counting is unavailable. Enter the products and counts from your photo." :
        result.rows.length ? "Check the product, pack size and number of sellable packs." : "No products were recognized. Add the products you can see.");
    } });
  }
  if (!photo) return <PhotoCamera copy={{ label: "New stock arrived", ask: "Photograph the delivery with pack labels visible",
    check: "Can you see the products and pack sizes?", alt: "Delivery to be counted" }}
    saving={preview.isPending} error={preview.error?.message ?? null} onClose={onBack} onUse={read} />;

  const duplicate = new Set(rows.map(r => r.listingId).filter(Boolean)).size < rows.filter(r => r.listingId).length;
  const valid = rows.length > 0 && !duplicate && rows.every(row => {
    const product = products.find(l => l.id === row.listingId);
    return product && whole(row.units, 1, 100000) && (product.unitsAvailable !== null || whole(row.opening, 0, 1000000));
  });
  return <div className="mr-shell">
    <div className="mr-header"><button className="back" aria-label="Back to Camera" disabled={locked} onClick={onBack}><ChevronLeftIcon /></button>
      <h2 className="serif">New stock arrived</h2></div>
    <div className="mr-scroll"><div className="mr-availability mr-delivery">
      {save.data ? <><h3 className="serif">Stock updated</h3><p>Added {save.data.units} units across {save.data.products} {save.data.products === 1 ? "listing" : "listings"}.</p>
        <button className="mr-bigbtn green" onClick={onBack}>Done</button></> : <>
        <h3 className="serif">Review your delivery</h3>
        <img src={photo} alt="Your delivery" />
        <p role="status">{hint}</p>
        {listings.isError && <button className="mr-secondary" onClick={() => void listings.refetch()}>Retry loading listings</button>}
        {listings.data && !products.length && <p>Your shop needs a listing before it can receive stock.</p>}
        {rows.map((row, index) => {
          const product = products.find(p => p.id === row.listingId);
          return <fieldset key={row.key} disabled={locked}><legend>{row.label || `Product ${index + 1}`}</legend>
            <label>Store listing<select value={row.listingId} onChange={e => update(row.key, { listingId: e.target.value, opening: "" })}>
              <option value="">Choose a listing</option>
              {products.map(p => <option key={p.id} value={p.id}>{p.name} · {p.packSize} · ${(p.priceCents / 100).toFixed(2)}</option>)}
            </select></label>
            {product?.unitsAvailable === null && <label>Available before this delivery<input type="number" inputMode="numeric" min="0" max="1000000"
              value={row.opening} onChange={e => update(row.key, { opening: e.target.value })} /><small>Count units already on hand that are free to sell.</small></label>}
            <label>Sellable packs delivered<input type="number" inputMode="numeric" min="1" max="100000" value={row.units}
              onChange={e => update(row.key, { units: e.target.value })} /></label>
            {product?.unitsAvailable != null && <p>{product.unitsAvailable} units currently available.</p>}
            {product?.pausedUntil && <p>The listing stays paused until {new Date(product.pausedUntil).toLocaleDateString()}.</p>}
            <button className="mr-secondary" onClick={() => setRows(old => old.filter(r => r.key !== row.key))}>Remove product</button>
          </fieldset>;
        })}
        {duplicate && <p role="alert">Combine counts for the same listing.</p>}
        <button className="mr-secondary" disabled={locked || rows.length >= 50} onClick={() => setRows(old => [...old, newRow()])}>Add product</button>
        {save.error && <p role="alert">{save.error.message}</p>}
        <button className="mr-bigbtn green" disabled={save.isPending || (!uncertain && (!valid || listings.isFetching))} onClick={() => {
          if (uncertain && pendingReceipt) { save.mutate(pendingReceipt); return; }
          const receipt = { requestId, lines: rows.map(row => ({ listingId: row.listingId, units: Number(row.units),
            opening: products.find(l => l.id === row.listingId)!.unitsAvailable === null ? Number(row.opening) : null })) };
          setPendingReceipt(receipt);
          save.mutate(receipt);
        }}>{save.isPending ? "Updating stock…" : uncertain ? "Retry confirmation" : "Confirm delivery"}</button>
      </>}
    </div></div>
  </div>;
}
