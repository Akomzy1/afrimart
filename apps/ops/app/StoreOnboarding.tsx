"use client";

import { useState } from "react";
import { trpc } from "@afrimart/api-client";

export function CreateStore() {
  const utils = trpc.useUtils();
  const hubs = trpc.admin.hubs.useQuery();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [ownerName, setOwnerName] = useState("");
  const [phone, setPhone] = useState("");
  const [sellerType, setSellerType] = useState<"store" | "home_seller" | "aspiring_entrepreneur">("store");
  const [hub, setHub] = useState("");
  const create = trpc.admin.createStore.useMutation({ onSuccess: async () => {
    await utils.admin.stores.invalidate(); setOpen(false); setName(""); setOwnerName(""); setPhone("");
  } });
  if (!open) return <div className="op-form"><button className="op-btn primary" onClick={() => setOpen(true)}>Create store</button></div>;
  return <form className="op-card" onSubmit={(e) => { e.preventDefault(); create.mutate({ name, ownerName, phone, sellerType, hubMetroId: hub }); }}>
    <h2>Create a pending store</h2><p className="lede">The owner must verify their number and complete their details before approval.</p>
    <div className="op-form">
      <div><label htmlFor="new-store-name">Business name</label><input id="new-store-name" className="op-input" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} /></div>
      <div><label htmlFor="new-store-owner">Owner name</label><input id="new-store-owner" className="op-input" required minLength={2} maxLength={120} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} /></div>
      <div><label htmlFor="new-store-phone">Owner phone</label><input id="new-store-phone" className="op-input" required type="tel" maxLength={40} value={phone} onChange={(e) => setPhone(e.target.value)} /></div>
      <div><label htmlFor="new-store-type">Seller type</label><select id="new-store-type" className="op-select" value={sellerType} onChange={(e) => setSellerType(e.target.value as typeof sellerType)}><option value="store">Store</option><option value="home_seller">Home seller</option><option value="aspiring_entrepreneur">New entrepreneur</option></select></div>
      <div><label htmlFor="new-store-hub">Supply hub</label><select id="new-store-hub" className="op-select" required value={hub} onChange={(e) => setHub(e.target.value)}><option value="">Choose a hub</option>{hubs.data?.map((h) => <option key={h.id} value={h.id}>{h.name}, {h.state}</option>)}</select></div>
      <button className="op-btn primary" disabled={create.isPending || !hub}>{create.isPending ? "Creating…" : "Save store"}</button>
      <button type="button" className="op-btn" onClick={() => setOpen(false)}>Cancel</button>
    </div>
    {create.error && <p className="op-err" role="alert">{create.error.message}</p>}
  </form>;
}

export function StoreOnboardingActions({ storeId }: { storeId: string }) {
  const utils = trpc.useUtils();
  const [kitOpen, setKitOpen] = useState(false);
  const [packaging, setPackaging] = useState("");
  const [serial, setSerial] = useState("");
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [copied, setCopied] = useState(false);
  const [copyFailed, setCopyFailed] = useState(false);
  const invite = trpc.admin.issueOnboardingInvite.useMutation({ onSuccess: () => { setCopied(false); setCopyFailed(false); } });
  const kit = trpc.admin.recordOnboardingKit.useMutation({ onSuccess: async () => {
    await utils.admin.stores.invalidate(); setKitOpen(false); setPackaging(""); setSerial("");
  } });
  const inviteUrl = invite.data ? new URL(invite.data.path, process.env.NEXT_PUBLIC_MERCHANT_URL ?? "http://localhost:3001").href : "";
  return <div className="op-onboarding-actions">
    <div className="op-actions"><button className="op-btn" disabled={invite.isPending} onClick={() => invite.mutate({ id: storeId })}>Issue invitation</button><button className="op-btn" onClick={() => setKitOpen(!kitOpen)}>Record kit</button></div>
    {inviteUrl && <div className="op-invite">
      <label htmlFor={`invite-${storeId}`}>Owner invitation (expires in 7 days)</label>
      <input id={`invite-${storeId}`} className="op-input" readOnly value={inviteUrl} onFocus={(e) => e.target.select()} />
      <button className="op-btn" onClick={async () => { try { await navigator.clipboard.writeText(inviteUrl); setCopied(true); } catch { setCopyFailed(true); } }}>{copied ? "Copied" : "Copy link"}</button>
      {copyFailed && <p>Select the link above and copy it.</p>}
    </div>}
    {kitOpen && <form className="op-kit-form" onSubmit={(e) => { e.preventDefault(); kit.mutate({ id: storeId, packaging, labelPrinterSerial: serial, issuedAt: new Date(`${date}T00:00:00.000Z`) }); }}>
      <label htmlFor={`packaging-${storeId}`}>Packaging issued</label><input id={`packaging-${storeId}`} className="op-input" required maxLength={500} value={packaging} onChange={(e) => setPackaging(e.target.value)} />
      <label htmlFor={`printer-${storeId}`}>Printer serial</label><input id={`printer-${storeId}`} className="op-input" required maxLength={120} value={serial} onChange={(e) => setSerial(e.target.value)} />
      <label htmlFor={`issued-${storeId}`}>Date issued</label><input id={`issued-${storeId}`} className="op-input" required type="date" max={new Date().toISOString().slice(0, 10)} value={date} onChange={(e) => setDate(e.target.value)} />
      <button className="op-btn primary" disabled={kit.isPending}>Save kit record</button>
    </form>}
    {(invite.error || kit.error) && <p className="op-err" role="alert">{invite.error?.message ?? kit.error?.message}</p>}
  </div>;
}
