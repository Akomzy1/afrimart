"use client";

import { useEffect, useState } from "react";
import { trpc } from "@afrimart/api-client";
import { ShipCheckIcon } from "@afrimart/ui";

export function ReprintLabel({ shipmentId }: { shipmentId: string }) {
  const [show, setShow] = useState(false);
  return <>
    <button type="button" className="mr-secondary" aria-expanded={show} onClick={() => setShow(!show)}>
      {show ? "Close label options" : "Reprint label"}
    </button>
    {show && <ShippingLabel shipmentId={shipmentId} />}
  </>;
}

export function ShippingLabel({ shipmentId, onPrinted }: { shipmentId: string; onPrinted?: () => void }) {
  const [paper, setPaper] = useState<"4x6" | "letter">("4x6");
  const [opened, setOpened] = useState(false);
  const label = trpc.merchant.shippingLabel.useQuery({ shipmentId, paper }, { retry: false });
  const pdf = label.data?.kind === "test" ? label.data.pdf : null;
  const [file, setFile] = useState<{ pdf: string; url: string } | null>(null);
  useEffect(() => {
    if (!pdf) return;
    const bytes = Uint8Array.from(atob(pdf), char => char.charCodeAt(0));
    const url = URL.createObjectURL(new Blob([bytes], { type: "application/pdf" }));
    setFile({ pdf, url });
    return () => URL.revokeObjectURL(url);
  }, [pdf]);

  if (label.isError) return <div role="alert">
    <p>{label.error.message}</p>
    <button type="button" className="mr-secondary" onClick={() => void label.refetch()}>Check again</button>
  </div>;
  const url = label.data?.kind === "issued" ? label.data.url : file && file.pdf === pdf ? file.url : null;
  return (
    <div className="mr-label">
      {label.data?.kind !== "issued" && (
        <label>Paper size
          <select value={paper} onChange={(e) => { setPaper(e.target.value === "letter" ? "letter" : "4x6"); setOpened(false); }}>
            <option value="4x6">4 × 6 inch label</option>
            <option value="letter">US Letter (8½ × 11 inches)</option>
          </select>
        </label>
      )}
      {url ? <a className="mr-bigbtn green" href={url} target="_blank" rel="noopener noreferrer" onClick={() => setOpened(true)}>
        <ShipCheckIcon /> Open label PDF
      </a> : <button type="button" className="mr-bigbtn disabled" disabled>Preparing label…</button>}
      {label.data?.kind === "test" && <div className="mr-barhint">Test label · No postage. Print at 100%.</div>}
      {opened && onPrinted && <button type="button" className="mr-secondary" onClick={onPrinted}>I’ve printed it · Continue packing</button>}
    </div>
  );
}
