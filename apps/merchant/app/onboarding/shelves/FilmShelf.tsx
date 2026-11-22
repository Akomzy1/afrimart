"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CameraIcon, CheckIcon, toJpegDataUrl } from "@afrimart/ui";
import { trpc } from "@afrimart/api-client";
import { assessFrame, coaching, sameStretch, type Guidance } from "../capture";

type Candidate = ReturnType<typeof assessFrame> & { jpeg: string };
const MAX_PASS_LENGTH = 10_000_000;

export function FilmShelf({ shelf, limit, revision, onClose, onSaved }: {
  shelf: number; limit: number; revision: number; onClose: () => void; onSaved: () => Promise<void>;
}) {
  const video = useRef<HTMLVideoElement>(null);
  const samples = useRef<Candidate[]>([]);
  const analysis = useRef<HTMLCanvasElement | null>(null);
  const [passId] = useState(() => crypto.randomUUID());
  const [count, setCount] = useState(0);
  const [guidance, setGuidance] = useState<Guidance>("seek");
  const [running, setRunning] = useState(true);
  const [ready, setReady] = useState(false);
  const [notice, setNotice] = useState("");
  const [frozen, setFrozen] = useState(false);
  const busy = useRef(false);
  const upload = trpc.shelfCapture.saveShelf.useMutation();
  const fileInput = useRef<HTMLInputElement>(null);
  const consider = useCallback((source: CanvasImageSource, width: number, height: number) => {
    const canvas = analysis.current ??= document.createElement("canvas");
    canvas.width = 160;
    canvas.height = Math.max(32, Math.min(240, Math.round(160*height/width)));
    const ctx = canvas.getContext("2d", { willReadFrequently: true });
    if (!ctx) throw new Error("Camera preview unavailable.");
    ctx.drawImage(source, 0, 0, canvas.width, canvas.height);
    const frame = assessFrame(ctx.getImageData(0, 0, canvas.width, canvas.height).data, canvas.width, canvas.height);
    setGuidance(frame.guidance);
    if (frame.guidance !== "good") return;
    const kept = samples.current;
    const index = kept.findIndex(other => sameStretch(other, frame));
    if (index >= 0 && kept[index].score >= frame.score) return;
    if (index < 0 && kept.length === limit) {
      setNotice("This capture has reached 60 frames. Save this shelf to continue.");
      setRunning(false);
      return;
    }
    const jpeg = toJpegDataUrl(source, width, height);
    const length = kept.reduce((size, other, i) => size + (i === index ? 0 : other.jpeg.length), jpeg.length);
    if (length > MAX_PASS_LENGTH) {
      setNotice("Save this section, then film the rest as another shelf.");
      setRunning(false);
      return;
    }
    const candidate = { ...frame, jpeg };
    if (index >= 0) kept[index] = candidate;
    else kept.push(candidate);
    setCount(kept.length);
  }, [limit]);

  useEffect(() => {
    if (!running) return;
    let disposed = false;
    let stream: MediaStream | undefined;
    let timer: ReturnType<typeof setInterval> | undefined;
    function pause(message: string) {
      if (disposed) return;
      setNotice(message);
      setRunning(false);
    }
    function whenHidden() {
      if (document.hidden) pause("Camera paused. Your frames are still here.");
    }
    async function start() {
      try {
        const el = video.current;
        if (!el || !navigator.mediaDevices?.getUserMedia) throw new Error("Camera unavailable");
        stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } }, audio: false });
        if (disposed) { stream.getTracks().forEach(track => track.stop()); return; }
        el.srcObject = stream;
        await el.play();
        if (disposed) return;
        setReady(true);
        stream.getVideoTracks()[0]?.addEventListener("ended", () => pause("The camera stopped. Reopen it or choose a shelf photo."));
        timer = setInterval(() => {
          if (busy.current || !el.videoWidth || el.readyState < 2) return;
          try { consider(el, el.videoWidth, el.videoHeight); }
          catch { pause("The camera could not read this frame. Try a shelf photo."); }
        }, 500);
      } catch { pause("Allow camera access, or choose a shelf photo from your phone."); }
    }
    document.addEventListener("visibilitychange", whenHidden);
    void start();
    return () => {
      disposed = true;
      clearInterval(timer);
      stream?.getTracks().forEach(track => track.stop());
      document.removeEventListener("visibilitychange", whenHidden);
      setReady(false);
    };
  }, [running, consider]);

  async function choosePhoto(file?: File) {
    if (!file || busy.current) return;
    setRunning(false);
    setNotice("");
    try {
      const bitmap = await createImageBitmap(file);
      try { if (!busy.current) consider(bitmap, bitmap.width, bitmap.height); }
      finally { bitmap.close(); }
    } catch { setNotice("That photo could not be opened. Choose another or try the camera."); }
  }

  async function save() {
    if (!samples.current.length || busy.current) return;
    busy.current = true;
    setRunning(false);
    setFrozen(true);
    setNotice("");
    try {
      await upload.mutateAsync({ revision, passId, shelf, frames: samples.current.map(f => f.jpeg) });
      await onSaved();
    } catch {
      // Keep the images and request ID for a retry, including a lost response.
      busy.current = false;
    }
  }

  const [line, hint] = coaching[guidance];
  return <div className="mr-shell mr-onb">
    <div className="mr-header"><button className="mr-linkbtn" disabled={upload.isPending} onClick={onClose}>{count ? "Discard take" : "Back"}</button><h2 className="serif">Shelf {shelf}</h2></div>
    <div className="mr-scroll"><div className="mr-onb-content mr-shelf-camera">
      <div className="mr-fw"><div className="mr-filmview">
        <video ref={video} playsInline muted aria-label="Live shelf camera" hidden={!ready} />
        {!ready && count > 0 && <img src={samples.current[count-1].jpeg} alt="Last selected shelf frame" />}
        {!ready && !count && <CameraIcon />}
        {[1,2,3,4].map(i => <span key={i} className={`corner c${i}`} />)}
        <div className="mr-hud"><div className="row"><span className="mr-pill">{ready ? "Camera on" : "Camera off"}</span><span className="mr-pill saved"><b>{count}</b> ready</span></div></div>
      </div>
      <div className="mr-coachcard" role="status"><div className="ic">{guidance === "good" ? <CheckIcon /> : <CameraIcon />}</div>
        <div className="m"><div className="t">{line}</div><div className="h">{hint}</div></div></div></div>
      {notice && <p role="status">{notice}</p>}
      {upload.error && <p className="mr-signin-err" role="alert">{upload.error.message}</p>}
      {!running && !frozen && <button className="mr-linkbtn" onClick={() => { setNotice(""); setRunning(true); }}>Open camera</button>}
      {!frozen && <button className="mr-linkbtn" onClick={() => fileInput.current?.click()}>Choose a shelf photo</button>}
      <input hidden type="file" accept="image/*" ref={fileInput} onChange={e => { void choosePhoto(e.target.files?.[0]); e.target.value = ""; }} />
    </div></div>
    <div className="mr-actionbar"><button className="mr-bigbtn green" disabled={!count || upload.isPending} onClick={() => void save()}>{upload.isPending ? "Saving shelf…" : upload.error ? "Retry saving shelf" : "Save shelf"}</button></div>
  </div>;
}
