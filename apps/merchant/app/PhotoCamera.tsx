"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { CheckIcon, fileToJpegDataUrl, toJpegDataUrl } from "@afrimart/ui";

/**
 * QC-2 — the packing photo: the merchant photographs the open box, items
 * visible, before sealing it. AfriMart Merchant.html (box photo camera).
 *
 * A viewfinder with the corner guide and one big shutter; then "Are all items
 * visible?" with Retake and Use photo. Nothing else on screen.
 *
 * The photo is downscaled here before upload (a phone sensor produces several
 * megabytes the server would only shrink again) but that is a courtesy, not the
 * control: the server re-encodes everything it receives and strips its metadata,
 * including the GPS position of the shop, regardless of what this does.
 *
 * If the camera is unavailable or refused, the same flow runs from the phone's
 * own camera through a file input. A merchant with a blocked permission must
 * still be able to ship.
 */

const retakeIcon = (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
    <path d="M4 4v6h6" strokeLinecap="round" strokeLinejoin="round" />
    <path d="M20 12a8 8 0 0 1-14.6 4.5M4 10a8 8 0 0 1 14.6-2.5" strokeLinecap="round" />
  </svg>
);

/** What the camera is for. The box photo is the default; a document uses the same screen. */
export interface CameraCopy {
  /** Top bar, beside the close button. */
  label: string;
  /** Before the shot. */
  ask: string;
  /** After the shot, before it is kept. */
  check: string;
  /** What a screen reader hears for the preview. */
  alt: string;
}

export const BOX_PHOTO = (orderRef: string): CameraCopy => ({
  label: `${orderRef} · Box photo`,
  ask: "Photograph the open box with all items visible",
  check: "Are all items visible?",
  alt: "The photo you just took of the open box",
});

export const DOCUMENT_PHOTO = (name: string): CameraCopy => ({
  label: name,
  ask: "Photograph the whole page, flat and in focus",
  check: "Can you read every line?",
  alt: `The photo you just took of your ${name.toLowerCase()}`,
});

export function PhotoCamera({
  copy,
  saving,
  error,
  onClose,
  onUse,
}: {
  copy: CameraCopy;
  saving: boolean;
  error: string | null;
  onClose: () => void;
  onUse: (dataUrl: string) => void;
}) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [captured, setCaptured] = useState<string | null>(null);
  const [cameraReady, setCameraReady] = useState(false);
  const [noCamera, setNoCamera] = useState(false);
  const [flash, setFlash] = useState(false);

  const stop = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
  }, []);

  const start = useCallback(async () => {
    setCameraReady(false);
    if (!navigator.mediaDevices?.getUserMedia) {
      setNoCamera(true);
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        video: { facingMode: { ideal: "environment" }, width: { ideal: 1920 } },
        audio: false,
      });
      streamRef.current = stream;
      const video = videoRef.current;
      if (video) {
        video.srcObject = stream;
        await video.play().catch(() => undefined);
        setCameraReady(true);
      }
    } catch {
      setNoCamera(true);
    }
  }, []);

  useEffect(() => {
    void start();
    return stop;
  }, [start, stop]);

  function shoot() {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return;
    setCaptured(toJpegDataUrl(video, video.videoWidth, video.videoHeight));
    setFlash(true);
    stop();
  }

  function retake() {
    setCaptured(null);
    void start();
  }

  async function picked(file: File | undefined) {
    if (!file) return;
    try {
      setCaptured(await fileToJpegDataUrl(file));
    } catch {
      setNoCamera(true);
    }
  }

  const live = captured === null;

  return (
    <div className="mr-pcam" role="dialog" aria-modal="true" aria-label={copy.label}>
      <div className="mr-pcam-top">
        <button type="button" className="pcx" aria-label="Close" onClick={onClose}>
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-hidden="true">
            <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
          </svg>
        </button>
        <span className="oid">{copy.label}</span>
      </div>

      <div className="mr-pcam-ins">{live ? copy.ask : copy.check}</div>

      <div className="mr-pcam-vf">
        <div className={`mr-scene${live ? " live" : ""}`}>
          {/* The video stays mounted while previewing so retake does not re-create the element. */}
          <video ref={videoRef} playsInline muted style={{ display: live && cameraReady ? "block" : "none" }} />
          {captured && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={captured} alt={copy.alt} />
          )}
          {live && !cameraReady && (
            <div className="mr-pcam-msg">
              {noCamera
                ? "The camera isn't available here. You can take the photo with your phone's own camera instead."
                : "Starting the camera…"}
            </div>
          )}
        </div>
        {live && cameraReady && (
          <div className="mr-guide" aria-hidden="true">
            <i className="g1" />
            <i className="g2" />
            <i className="g3" />
            <i className="g4" />
          </div>
        )}
        {flash && <div className="mr-flash go" onAnimationEnd={() => setFlash(false)} />}
      </div>

      {error && <div className="mr-pcam-err">{error}</div>}

      <div className="mr-pcam-foot">
        {live ? (
          noCamera ? (
            <>
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                hidden
                onChange={(e) => {
                  void picked(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <button type="button" className="mr-bigbtn accent" onClick={() => fileRef.current?.click()}>
                Open the camera
              </button>
            </>
          ) : (
            <button type="button" className="mr-pshutter" aria-label="Take photo" disabled={!cameraReady} onClick={shoot} />
          )
        ) : (
          <>
            <button type="button" className="mr-bigbtn dark" disabled={saving} onClick={retake}>
              {retakeIcon}Retake
            </button>
            <button type="button" className="mr-bigbtn accent" disabled={saving} onClick={() => onUse(captured!)}>
              <CheckIcon strokeWidth={2.6} />
              {saving ? "Saving…" : "Use photo"}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
