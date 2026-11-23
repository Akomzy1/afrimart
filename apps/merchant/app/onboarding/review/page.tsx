"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { trpc, type RouterOutputs } from "@afrimart/api-client";
import { ChevronLeftIcon } from "@afrimart/ui";
import { photoUrl } from "../../providers";
import { SignIn } from "../../SignIn";

type Item = RouterOutputs["catalogueReview"]["state"]["items"][number];
const priceText = (cents: number | null) => cents === null ? "" : (cents / 100).toFixed(2);

export default function ReviewPage() {
  const router = useRouter();
  const utils = trpc.useUtils();
  const review = trpc.catalogueReview.state.useQuery(undefined, { retry: false,
    refetchInterval: q => ["queued","running"].includes(q.state.data?.state ?? "") && !q.state.data?.paused ? 3000 : q.state.data?.submitted ? 10000 : false });
  const [active, setActive] = useState("");
  const refresh = async () => { await review.refetch(); };
  const reimport = trpc.onboarding.importWebsite.useMutation({ onSuccess: refresh });
  const retry = trpc.catalogueReview.retry.useMutation({ onSuccess: refresh });
  const publish = trpc.catalogueReview.publish.useMutation({ onSuccess: async () => { await refresh(); await utils.merchant.me.invalidate(); }, onError: refresh });
  const refilm = trpc.catalogueReview.refilm.useMutation({ onSuccess: async () => {
    await utils.shelfCapture.session.invalidate(); await utils.onboarding.state.invalidate(); router.push("/onboarding/shelves");
  } });
  if (review.error?.data?.code === "UNAUTHORIZED") return <SignIn onSignedIn={() => { void refresh(); }} />;
  const data = review.data;
  const item = data?.items.find(i => i.id === active);
  const ready = data?.state === "ready";
  const done = Boolean(data?.submitted);
  const left = data?.items.filter(i => i.decision === "open").length ?? 0;
  const failure = review.error ?? publish.error ?? retry.error ?? refilm.error ?? reimport.error;
  return <div className="mr-shell mr-onb">
    <div className="mr-header"><Link className="back" href="/onboarding" aria-label="Back to store setup"><ChevronLeftIcon /></Link><h2 className="serif">Catalogue review</h2></div>
    <div className="mr-scroll"><div className="mr-onb-content">
      {failure && <p role="alert" className="mr-signin-err">{failure.message}</p>}
      {!data && !review.error && <p role="status">Opening your catalogue…</p>}
      {data && !ready && <div className="mr-onb-head"><h1 className="serif">{data.state === "failed" ? "Shelf reading stopped." : data.paused ? "Your shelves are in the queue." : "Reading your shelves…"}</h1>
        <p>{data.message ?? (data.paused ? "Shelf reading is paused. You can return here when it resumes." : "You can leave and return to this screen.")}</p>
        {data.captureExpired ? <button className="mr-linkbtn" disabled={refilm.isPending} onClick={() => refilm.mutate({ revision: data.revision })}>Expired photos · film again</button> : data.state === "failed" && <button className="mr-linkbtn" disabled={retry.isPending} onClick={() => retry.mutate()}>Try reading again</button>}</div>}
      {data && ready && (item && !done ? <Editor website={!!data.websiteUrl} key={item.id + "-" + data.revision} item={item} items={data.items} revision={data.revision}
        close={() => setActive("")} refresh={refresh} /> : <>
        <div className="mr-onb-head"><h1 className="serif">{done ? "Catalogue submitted." : data.items.length ? "Check your products." : "No products to review."}</h1>
          <p>{done ? "Staff will review any items you sent for help. Buyers can shop once your store is approved and live." : data.items.length ?
            (left ? `${left} of ${data.items.length} still need your review. Check each product and its price.` : "Every item has been reviewed. Submit the catalogue when you’re ready.") : data.websiteUrl ? "Check your website for new products." : "Film the shelves again with the product labels and price tags in view."}</p></div>
        <div className="mr-rtiles">{data.items.map(i => <div className="mr-rtile" key={i.id}>
          {i.preview && <img className="mr-review-photo" src={photoUrl(i.preview)} alt={`Shelf showing ${i.name}`} />}
          <div className="b"><strong className="nm">{i.name}</strong><div className="meta">{[i.brand,i.packSize].filter(Boolean).join(" · ")}</div>
            <div className="price">{i.priceCents === null ? "Price needed" : "$" + priceText(i.priceCents)}</div>
            <p>{i.status === "rejected" ? i.note ?? "Declined by staff" : i.status === "approved" ? "Listing saved" : i.decision === "staff" ? "For staff review" :
              i.decision === "confirm" ? "Confirmed" : i.needsCheck ? "Needs a closer look" : "Ready to check"}</p>
            {i.photoRequestId && <FreshShelfPhoto id={i.id} requestId={i.photoRequestId} refresh={refresh} />}
            {!done && <button className="mr-linkbtn" onClick={() => { publish.reset(); setActive(i.id); }}>Review item</button>}</div>
        </div>)}</div>
        {!done && data.websiteUrl && <button className="mr-linkbtn" disabled={reimport.isPending} onClick={() => reimport.mutate()}>{reimport.isPending ? "Checking website…" : "Check website for new products"}</button>}
        {reimport.isSuccess && <p role="status">{reimport.data.added ? `Added ${reimport.data.added} new products.` : "No new products found."}</p>}
        {!done && !data.websiteUrl && !data.items.length && <button className="mr-bigbtn green" disabled={refilm.isPending} onClick={() => refilm.mutate({ revision: data.revision })}>Re-film shelves</button>}
      </>)}
    </div></div>
    {data && !item && ready && !done && data.items.length > 0 && <div className="mr-actionbar"><button className="mr-bigbtn green" disabled={left > 0 || publish.isPending}
      onClick={() => publish.mutate({ revision: data.revision })}>{publish.isPending ? "Submitting…" : "Submit catalogue"}</button></div>}
    {done && <div className="mr-actionbar"><Link className="mr-bigbtn green" href="/">Go to my store</Link></div>}
  </div>;
}

function FreshShelfPhoto({ id, requestId, refresh }: { id: string; requestId: string; refresh: () => Promise<void> }) {
  const upload = trpc.catalogueReview.supplyPhoto.useMutation({ onSuccess: refresh });
  const [error, setError] = useState("");
  async function choose(file?: File) {
    if (!file) return;
    setError("");
    try {
      const bitmap = await createImageBitmap(file);
      const scale = Math.min(1, 1600 / Math.max(bitmap.width, bitmap.height));
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(bitmap.width * scale));
      canvas.height = Math.max(1, Math.round(bitmap.height * scale));
      const context = canvas.getContext("2d");
      if (!context) throw new Error("Canvas unavailable");
      context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
      bitmap.close();
      upload.mutate({ id, requestId, image: canvas.toDataURL("image/jpeg", 0.85).split(",")[1]! });
    } catch { setError("Choose a readable photo and try again."); }
  }
  return <div><label>Staff requested a fresh shelf photo
    <input type="file" accept="image/*" disabled={upload.isPending} onChange={e => { void choose(e.target.files?.[0]); e.target.value = ""; }} />
  </label>{(error || upload.error) && <p role="alert">{error || upload.error?.message}</p>}</div>;
}

function Editor({ item, items, revision, close, refresh, website }: { website: boolean; item: Item; items: Item[]; revision: number; close: () => void; refresh: () => Promise<void> }) {
  const [name,setName] = useState(item.name), [price,setPrice] = useState(priceText(item.priceCents));
  const [product,setProduct] = useState(item.selected ?? ""), [search,setSearch] = useState(""), [target,setTarget] = useState("");
  const found = trpc.catalogueReview.search.useQuery({ text: search.trim() }, { enabled: search.trim().length >= 2 });
  const [picked, setPicked] = useState<Item["candidates"][number] | undefined>();
  const options = [...new Map([...item.candidates, ...(found.data ?? []), ...(picked ? [picked] : [])].map(p => [p.id,p])).values()];
  const standards = trpc.catalogueReview.standards.useQuery({ productId: product }, { enabled: !!product });
  const permit = trpc.merchant.confirmPermit.useMutation({ onSuccess: async () => { await standards.refetch(); } });
  const edit = trpc.catalogueReview.edit.useMutation({ onSuccess: async () => { close(); await refresh(); },
    onError: async e => { if (e.data?.code === "CONFLICT") { close(); await refresh(); } } });
  const cents = /^\d+(?:\.\d{1,2})?$/.test(price) ? Math.round(Number(price)*100) : null;
  function save(action: "confirm"|"staff"|"merge"|"remove") {
    edit.mutate({ id: item.id, revision, name: name.trim() || item.name, priceCents: cents, productId: product || null, action, target });
  }
  return <div className="mr-review-editor mr-profile-form">
    <button className="mr-linkbtn" onClick={close}>Back to products</button>
    {item.preview && <img className="mr-review-source" src={photoUrl(item.preview)} alt="Your original shelf photo" />}
    <p>{website ? "Imported from your website" : "Read from the shelf"} · {item.rawText}</p>
    <label>Product name<input value={name} maxLength={300} onChange={e => setName(e.target.value)} /></label>
    <label>{website ? "Price in dollars" : "Shelf price in dollars"}<input inputMode="decimal" value={price} onChange={e => setPrice(e.target.value)} /></label>
    <div className="mr-review-actions"><button aria-label="Reduce price by 25 cents" onClick={() => setPrice(priceText(Math.max(1,(cents ?? 0)-25)))}>− $0.25</button>
      <button aria-label="Increase price by 25 cents" onClick={() => setPrice(priceText((cents ?? 0)+25))}>+ $0.25</button></div>
    <label>Find another catalogue product<input value={search} maxLength={120} onChange={e => setSearch(e.target.value)} /></label>
    <label>Catalogue match<select value={product} onChange={e => { setProduct(e.target.value); setPicked(options.find(o => o.id === e.target.value)); }}>
      <option value="">Choose a match</option>{options.map(p => <option key={p.id} value={p.id}>{p.canonicalName} · {p.packSize}</option>)}</select></label>
    {standards.data?.violations.map(v => <p key={v.code} role="status">{v.message}</p>)}
    {standards.data?.permit && <button className="mr-linkbtn" disabled={permit.isPending} onClick={() => permit.mutate({ category: standards.data!.permit!.category, acknowledged: true })}>{standards.data.permit.statement}</button>}
    {standards.data?.manual && <p>This category needs a staff review.</p>}
    {(edit.error || permit.error || standards.error || found.error) && <p role="alert">{(edit.error ?? permit.error ?? standards.error ?? found.error)?.message}</p>}
    <button className="mr-bigbtn green" disabled={edit.isPending || !name.trim() || !cents || !product || !standards.data || !!standards.data.violations.length || standards.data.manual} onClick={() => save("confirm")}>Confirm item</button>
    <button className="mr-linkbtn" disabled={edit.isPending || (!!price && !cents)} onClick={() => save("staff")}>Send to staff for help</button>
    {items.length > 1 && <label>Merge duplicate into<select value={target} onChange={e => setTarget(e.target.value)}><option value="">Choose another item</option>
      {items.filter(i => i.id !== item.id).map(i => <option value={i.id} key={i.id}>{i.name} · {i.packSize} · {i.priceCents === null ? "Price needed" : "$"+priceText(i.priceCents)}</option>)}</select></label>}
    {target && <button className="mr-linkbtn" disabled={edit.isPending} onClick={() => save("merge")}>Merge these items</button>}
    <button className="mr-linkbtn" disabled={edit.isPending} onClick={() => save("remove")}>Remove item</button>
  </div>;
}
