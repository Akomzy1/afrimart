"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { trpc, type RouterOutputs } from "@afrimart/api-client";
import { CheckIcon, ChevronLeftIcon, CookPotIcon, ShipCheckIcon } from "@afrimart/ui";
import { SignIn } from "../SignIn";
import { InstallPrompt } from "./InstallPrompt";

/** The prototype's welcome, code and rail selection, backed by persisted
 * onboarding. The film path leads to private shelf capture; no sample catalogue or
 * pretend publication is reachable from this real registration flow. */
export default function OnboardingPage() {
  const utils = trpc.useUtils();
  const state = trpc.onboarding.state.useQuery(undefined, { retry: false });
  const [invite, setInvite] = useState<string | null>(null);
  const [inviteResult, setInviteResult] = useState(false);
  const accept = trpc.onboarding.acceptInvite.useMutation({ onSuccess: () => { setInvite(null); setInviteResult(true); } });
  useEffect(() => {
    const token = new URLSearchParams(window.location.hash.slice(1)).get("invite");
    if (token) {
      setInvite(token);
      // Keep a reload on this device resumable until the verified owner accepts.
      // The fragment is never sent in an HTTP request or Referer header.
    }
  }, []);
  useEffect(() => {
    if (invite && state.data && !accept.isPending && !accept.isError && !accept.isSuccess) accept.mutate({ token: invite });
  }, [invite, state.data, accept]);
  useEffect(() => {
    if (inviteResult) window.history.replaceState(null, "", window.location.pathname);
  }, [inviteResult]);

  if (state.isPending) return <div className="mr-shell"><p className="mr-onb-content" role="status">Opening your store…</p></div>;
  if (state.error?.data?.code === "UNAUTHORIZED") return <SignIn onboarding onSignedIn={() => { void state.refetch(); }} />;
  if (!state.data) return <div className="mr-shell"><div className="mr-onb-content"><p role="alert">We couldn&apos;t open your store. Please try again.</p><button className="mr-bigbtn accent" onClick={() => { void state.refetch(); }}>Try again</button></div></div>;
  return <StoreSetup store={state.data} refresh={() => Promise.all([state.refetch(), utils.merchant.me.invalidate()])} inviteError={accept.error?.message} />;
}

type StoreState = RouterOutputs["onboarding"]["state"];

function StoreSetup({ store, refresh, inviteError }: { store: StoreState; refresh: () => Promise<unknown>; inviteError?: string }) {
  const router = useRouter();
  const startImport = trpc.onboarding.importWebsite.useMutation({ onSuccess: async () => { await refresh(); router.push("/onboarding/review"); } });
  const [editRail, setEditRail] = useState(false);
  const [name, setName] = useState(store.name === "New seller" ? "" : store.name);
  const [ownerName, setOwnerName] = useState(store.ownerName);
  const [sellerType, setSellerType] = useState(store.sellerType);
  const [attested, setAttested] = useState(Boolean(store.foodSafetyAttestedAt));
  const [rail, setRail] = useState<"film" | "web">(store.onboardingRail === "web" ? "web" : "film");
  const [website, setWebsite] = useState(store.onboardingWebsite ?? "");
  const save = trpc.onboarding.saveProfile.useMutation({ onSuccess: () => { void refresh(); } });
  const choose = trpc.onboarding.chooseRail.useMutation({ onSuccess: async () => { await refresh(); setEditRail(false); } });
  const needsProfile = !store.onboardingProfileAt && store.onboardingStatus !== "live";
  const choosing = !needsProfile && (!store.onboardingRail || editRail) && !["live", "suspended", "delisted"].includes(store.onboardingStatus);
  const live = store.onboardingStatus === "live" && store.verificationStatus === "verified";
  const paused = ["suspended", "delisted"].includes(store.onboardingStatus);
  const canEdit = ["pending", "filming"].includes(store.onboardingStatus) && !store.filmSession?.extraction;
  const error = save.error?.message ?? choose.error?.message ?? startImport.error?.message;

  return (
    <div className="mr-shell mr-onb">
      <div className="mr-header">
        {editRail ? <button className="back" aria-label="Back" onClick={() => setEditRail(false)}><ChevronLeftIcon /></button> : <Link className="back" aria-label="Back to store" href="/"><ChevronLeftIcon /></Link>}
        <h2 className="serif">{needsProfile ? "Your store" : choosing ? "Get started" : "Store setup"}</h2>
      </div>
      <div className="mr-onb-steps" aria-label={needsProfile ? "Store details" : choosing ? "Catalogue preference" : "Registration saved"}>
        {[0, 1, 2].map((i) => <div key={i} className={`s${i <= (needsProfile ? 0 : choosing ? 1 : 2) ? " on" : ""}`} />)}
      </div>
      <div className="mr-scroll"><div className="mr-onb-content">
        {inviteError && <div className="mr-signin-err" role="alert">{inviteError}</div>}
        {needsProfile && !paused ? <>
          <div className="mr-onb-head"><h1 className="serif">Tell us about your store.</h1><p>Your phone is verified. These details help AfriMart review your store.</p></div>
          <form id="store-profile" className="mr-profile-form" onSubmit={(e) => { e.preventDefault(); if (attested) save.mutate({ name, ownerName, sellerType, foodSafetyAttested: true }); }}>
            <div className="mr-gfield"><label htmlFor="onb-name">Store or business name</label><div className="in"><input id="onb-name" required minLength={2} maxLength={120} value={name} onChange={(e) => setName(e.target.value)} autoComplete="organization" /></div></div>
            <div className="mr-gfield"><label htmlFor="onb-owner">Your name</label><div className="in"><input id="onb-owner" required minLength={2} maxLength={120} value={ownerName} onChange={(e) => setOwnerName(e.target.value)} autoComplete="name" /></div></div>
            <div className="mr-gfield"><label htmlFor="onb-type">How do you sell?</label><select id="onb-type" value={sellerType} onChange={(e) => setSellerType(e.target.value as typeof sellerType)}><option value="store">I run a grocery store</option><option value="home_seller">I sell from home</option><option value="aspiring_entrepreneur">I am starting a food business</option></select></div>
            <label className="mr-attestation"><input type="checkbox" checked={attested} onChange={(e) => setAttested(e.target.checked)} required /><span>I will follow the food-safety, storage and labelling requirements that apply to my products and hold the permits required to sell them.</span></label>
            <p className="mr-onb-resend">Your store stays private until AfriMart reviews and approves it.</p>
          </form>
        </> : choosing ? <>
          <div className="mr-onb-head"><h1 className="serif">How would you like to start?</h1><p>Choose how you would like to add your products.</p></div>
          <div className="mr-paths">
            <button type="button" className={`mr-pathcard film${rail === "film" ? " on" : ""}`} aria-pressed={rail === "film"} onClick={() => setRail("film")}><span className="ic"><CookPotIcon /></span><span className="m"><span className="t">Film your shelves</span><span className="s">Use your shelves to build your catalogue.</span><span className="badge">Most sellers start here</span></span></button>
            <button type="button" className={`mr-pathcard web${rail === "web" ? " on" : ""}`} aria-pressed={rail === "web"} onClick={() => setRail("web")}><span className="ic"><ShipCheckIcon /></span><span className="m"><span className="t">Connect your website</span><span className="s">Start with the products you already sell online.</span></span></button>
          </div>
          {rail === "web" && <div className="mr-gfield mr-profile-form"><label htmlFor="onb-site">Your website</label><div className="in"><input id="onb-site" type="url" placeholder="https://your-store.com" maxLength={500} value={website} onChange={(e) => setWebsite(e.target.value)} /></div></div>}
        </> : <>
          <div className="mr-onb-head"><CheckIcon /><h1 className="serif">{paused ? "Your store needs attention." : live ? "Your store is open." : "Your store is registered."}</h1><p>{paused ? "Contact AfriMart in Messages about the next step." : live ? "Buyers can find your approved products." : "Your store is not public yet. An AfriMart team member will help you add your products and review your store."}</p></div>
          <div className="mr-kit"><div className="kh">{store.name}</div><p>Owner: {store.ownerName}</p><p>Phone verified</p><p>{store.verificationStatus === "verified" ? "Seller approved" : "Seller approval pending"}</p>{store.onboardingRail && <p>Catalogue preference: {store.onboardingRail === "film" ? "Film your shelves" : "Connect your website"}</p>}
            {store.onboardingKits.map((kit) => <div className="mr-kitrow" key={kit.id}><span className="m"><span className="t">{kit.packaging}</span><span className="s">Printer {kit.labelPrinterSerial} · issued {new Date(kit.issuedAt).toLocaleDateString()}</span></span></div>)}
          </div>
          {canEdit && <button type="button" className="mr-linkbtn" onClick={() => setEditRail(true)}>Change catalogue preference</button>}
          {store.onboardingRail === "web" && store.onboardingStatus === "filming" && <Link href="/" className="mr-linkbtn">Go to my store</Link>}
          <InstallPrompt />
        </>}
        {error && <div className="mr-signin-err" role="alert">{error}</div>}
      </div></div>
      <div className="mr-actionbar">
        {needsProfile && !paused ? <button form="store-profile" type="submit" className="mr-bigbtn accent" disabled={save.isPending || !attested || name.trim().length < 2 || ownerName.trim().length < 2}>{save.isPending ? "Saving…" : "Save my details"}</button>
          : choosing ? <button type="button" className="mr-bigbtn accent" disabled={choose.isPending || (rail === "web" && !website.trim())} onClick={() => choose.mutate({ rail, website: rail === "web" ? website : undefined })}>{choose.isPending ? "Saving…" : "Save and continue"}</button>
          : ((store.onboardingRail === "film" && store.filmSession?.finishedAt) || (store.onboardingRail === "web" && store.filmSession?.extraction?.websiteUrl)) && !paused ? <Link className="mr-bigbtn accent" href="/onboarding/review">Review catalogue</Link>
          : store.onboardingRail === "web" && store.onboardingStatus === "filming" ? <button className="mr-bigbtn accent" disabled={startImport.isPending} onClick={() => startImport.mutate()}>{startImport.isPending ? "Importing products…" : "Import website products"}</button>
          : store.onboardingRail === "film" && store.onboardingStatus === "filming" ? <Link className="mr-bigbtn accent" href="/onboarding/shelves">Open shelf filming</Link>
          : <Link className="mr-bigbtn accent" href="/">Go to my store</Link>}
      </div>
    </div>
  );
}
