"use client";

import Link from "next/link";
import { useState } from "react";
import { trpc } from "@afrimart/api-client";
import { CameraIcon, ChevronLeftIcon } from "@afrimart/ui";
import { photoUrl } from "../../providers";
import { SignIn } from "../../SignIn";
import { FilmShelf } from "./FilmShelf";

export default function ShelvesPage() {
  const session = trpc.shelfCapture.session.useQuery(undefined, { retry: false });
  const [pass, setPass] = useState<{ shelf: number; limit: number; revision: number } | null>(null);
  const finish = trpc.shelfCapture.finish.useMutation({ onSuccess: () => session.refetch().then(() => undefined) });
  if (session.error?.data?.code === "UNAUTHORIZED") return <SignIn onSignedIn={() => { void session.refetch(); }} />;
  const data = session.data;
  if (pass && data && !session.error) return <FilmShelf {...pass} onClose={() => { setPass(null); void session.refetch(); }}
    onSaved={async () => { await session.refetch(); setPass(null); }} />;
  const total = data?.shelves.reduce((count, shelf) => count + shelf.count, 0) ?? 0;
  function open(shelf: number, oldCount = 0) {
    if (data) setPass({ shelf, revision: data.revision, limit: 60 - total + oldCount });
  }
  return <div className="mr-shell mr-onb">
    <div className="mr-header"><Link href="/onboarding" className="back" aria-label="Back to store setup"><ChevronLeftIcon /></Link><h2 className="serif">Shelf filming</h2></div>
    <div className="mr-scroll"><div className="mr-onb-content">
      {session.isPending ? <p role="status">Opening your shelves…</p> : session.error ? <><p role="alert">{session.error.message}</p><Link href="/onboarding">Open store setup</Link></> : data && <>
        <div className="mr-onb-head"><h1 className="serif">{data.finished ? "Your shelf photos are saved." : total ? "Your saved shelves" : "Film your first shelf"}</h1>
          <p>{data.finished ? "Your photos are private. Your catalogue still needs to be prepared and reviewed." : "Work along one shelf at a time. Keep the products and price tags in view, then save the shelf before moving on."}</p></div>
        <ul className="mr-shelf-list">{data.shelves.map(s => <li key={s.number}>
          {s.preview && <img src={photoUrl(s.preview)} width="64" height="64" alt={`Shelf ${s.number} preview`} />}
          <div><strong>Shelf {s.number}</strong><span>{s.count} {s.count === 1 ? "frame" : "frames"} saved</span></div>
          {!data.finished && <button className="mr-linkbtn" onClick={() => open(s.number, s.count)} disabled={finish.isPending} aria-label={`Re-film shelf ${s.number}`}>Re-film</button>}
        </li>)}</ul>
        {!data.finished && total < 60 && <button className="mr-bigbtn accent" disabled={finish.isPending} onClick={() => open(data.shelves.length + 1)}><CameraIcon /> Film shelf {data.shelves.length + 1}</button>}
        {total >= 60 && !data.finished && <p>All 60 frames are saved. You can re-film a shelf or finish.</p>}
        {finish.error && <p role="alert">{finish.error.message}</p>}
      </>}
    </div></div>
    {data && !session.error && (data.finished ? <div className="mr-actionbar"><Link className="mr-bigbtn accent" href="/onboarding/review">Review catalogue</Link></div> : total > 0 &&
      <div className="mr-actionbar"><button className="mr-bigbtn green" disabled={finish.isPending} onClick={() => finish.mutate({ revision: data.revision }, { onError: () => { void session.refetch(); } })}>{finish.isPending ? "Finishing…" : "Done filming"}</button></div>)}
  </div>;
}
