"use client";

import { useEffect, useRef, useState } from "react";
import { trpc, type RouterOutputs } from "@afrimart/api-client";
import { ChevronLeftIcon, MicIcon } from "@afrimart/ui";

type Listing = RouterOutputs["merchant"]["listings"][number];
type Review = { until: Date; matches: Listing[] };
const weekdays = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];
const words = (s: string) => s.normalize("NFKD").replace(/\p{M}/gu, "").toLowerCase().replace(/[^\p{L}\p{N}]+/gu, " ").trim();
const returnTime = (date: Date) => date.toLocaleString(undefined, {
  weekday: "long", month: "long", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short",
});

function reviewNote(note: string, listings: Listing[]): Review {
  const parsed = words(note).match(/^(.+?) (?:is |are )?(?:out(?: of stock)?|sold out|finished) (?:until|till) (\w+)$/);
  if (!parsed) throw Error("Include the product and when it returns, for example “ogbono is out until Friday”.");
  const [, product, day] = parsed;
  const until = new Date();
  const weekday = weekdays.indexOf(day!);
  if (day !== "tomorrow" && weekday < 0) throw Error("Use a weekday or “tomorrow” for the return date.");
  const days = day === "tomorrow" ? 1 : (weekday - until.getDay() + 7) % 7 || 7;
  until.setDate(until.getDate() + days);
  until.setHours(0, 0, 0, 0);
  const matches = listings.filter(l => !l.hidden && [l.name, ...l.aliases].some(name =>
    (" " + words(name + " " + l.packSize) + " ").includes(" " + product + " ")));
  if (!matches.length) throw Error("No editable listing matched. Check the product name or try its other name.");
  return { until, matches };
}

interface Recognition {
  lang: string;
  onresult: ((event: { results: SpeechRecognitionResultList }) => void) | null;
  onend: (() => void) | null;
  onerror: (() => void) | null;
  start(): void;
  stop(): void;
  abort(): void;
}

export function AvailabilityUpdate({ onBack }: { onBack: () => void }) {
  const listings = trpc.merchant.listings.useQuery();
  const utils = trpc.useUtils();
  const [note, setNote] = useState("");
  const [review, setReview] = useState<Review | null>(null);
  const [selected, setSelected] = useState("");
  const [message, setMessage] = useState("");
  const [listening, setListening] = useState(false);
  const [saved, setSaved] = useState(false);
  const microphone = useRef<Recognition | null>(null);
  const pause = trpc.merchant.pauseListing.useMutation({
    onSuccess: () => { setSaved(true); void utils.merchant.listings.invalidate(); },
    onError: async error => {
      setMessage(error.message);
      if (error.data?.code === "CONFLICT") { setReview(null); await utils.merchant.listings.invalidate(); }
    },
  });
  useEffect(() => () => {
    const active = microphone.current;
    if (active) { active.onresult = active.onend = active.onerror = null; active.abort(); }
  }, []);

  function speak() {
    if (microphone.current) { microphone.current.stop(); return; }
    const browser = window as Window & { SpeechRecognition?: new () => Recognition; webkitSpeechRecognition?: new () => Recognition };
    const Recognizer = browser.SpeechRecognition ?? browser.webkitSpeechRecognition;
    if (!Recognizer) { setMessage("Voice input is unavailable in this browser. Type your update below."); return; }
    const active = new Recognizer();
    active.lang = "en-US";
    active.onresult = event => { setNote(event.results[0]?.[0]?.transcript ?? ""); setMessage(""); };
    active.onerror = () => setMessage("Couldn’t hear the update. Try again or type it below.");
    active.onend = () => { microphone.current = null; setListening(false); };
    try { active.start(); microphone.current = active; setListening(true); setMessage(""); }
    catch { setMessage("Couldn’t start voice input. Type your update below."); }
  }
  function preview() {
    try {
      const next = reviewNote(note, listings.data ?? []);
      setReview(next); setSelected(next.matches.length === 1 ? next.matches[0]!.id : ""); setMessage("");
    } catch (error) { setMessage((error as Error).message); }
  }
  const listing = review?.matches.find(l => l.id === selected);
  return <div className="mr-shell">
    <div className="mr-header"><button type="button" className="back" onClick={onBack} aria-label="Back to Camera"><ChevronLeftIcon /></button>
      <h2 className="serif">Update availability</h2></div>
    <div className="mr-scroll"><div className="mr-availability">
      {review ? <>
        <h3 className="serif">{saved ? "Listing paused" : "Review your update"}</h3>
        {review.matches.length > 1 && !saved ? <label>Which listing?
          <select value={selected} disabled={pause.isPending} onChange={e => setSelected(e.target.value)}>
            <option value="">Choose a product</option>
            {review.matches.map(l => <option key={l.id} value={l.id}>{l.name} · {l.packSize} · ${(l.priceCents / 100).toFixed(2)}</option>)}
          </select></label> : <p>{listing?.name} · {listing?.packSize}</p>}
        <p>Available again <strong>{returnTime(review.until)}</strong></p>
        {saved ? <button className="mr-bigbtn green" onClick={onBack}>Done</button> : <>
          <button className="mr-bigbtn green" disabled={!listing || pause.isPending} onClick={() => listing && pause.mutate({
            listingId: listing.id, expectedUpdatedAt: new Date(listing.updatedAt).toISOString(), until: review.until.toISOString(),
          })}>{pause.isPending ? "Saving…" : "Confirm pause"}</button>
          <button className="mr-secondary" disabled={pause.isPending} onClick={() => { setReview(null); setMessage(""); }}>Edit update</button>
        </>}
      </> : <>
        <button type="button" className="mr-bigbtn green" onClick={speak}><MicIcon />{listening ? "Stop listening" : "Speak update"}</button>
        <label>Your update<textarea rows={3} maxLength={300} disabled={listening} value={note}
          placeholder="Ogbono is out until Friday" onChange={e => { setNote(e.target.value); setMessage(""); }} /></label>
        <button className="mr-bigbtn accent" disabled={listening || !note.trim() || !listings.data || listings.isFetching} onClick={preview}>Review update</button>
        {listings.isError && <button className="mr-secondary" onClick={() => void listings.refetch()}>Couldn’t load products. Try again</button>}
      </>}
      {message && <p role="alert">{message}</p>}
    </div></div>
  </div>;
}
