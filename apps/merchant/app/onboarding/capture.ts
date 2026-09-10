/**
 * ONB-3 — guided capture feedback, from AfriMart Merchant - Onboarding.html (v2).
 *
 * The earlier export had no feedback model at all: a fixed carousel of
 * encouraging lines on a timer, and a counter that only ever incremented. This
 * one detects unusable frames and asks for a re-shoot. Two rules hold the
 * honesty together:
 *
 *   1. A rejected frame pauses recording and saves nothing.
 *   2. A tag we know exists but cannot read is booked as a redo, so the shelf
 *      is marked as needing another pass rather than silently skipped.
 *
 * Tone throughout is an instruction, not a diagnosis — "Come a little closer",
 * never "Frame rejected: subject distance out of range" — and the one state
 * that may never succeed (a worn or handwritten tag) offers a way out.
 */

export type CaptureState = "seek" | "blur" | "far" | "near" | "tag" | "good" | "done";

export interface CaptureCopy {
  /** Drives the coach icon and the frame's accent tone. */
  icon: CaptureState;
  /** The single instruction. One at a time, always. */
  line: string;
  /** How to fix it, in physical terms the owner can act on. */
  hint: string;
  /** What the camera currently reads off the tag. */
  read: string;
  /** True while the frame is unusable — recording pauses and nothing is saved. */
  paused?: boolean;
  /** Escape hatch for a tag that may never resolve. */
  act?: string;
  /** Green confirmation toast text. */
  toast?: string;
}

export const CAPTURE_STATES: Record<CaptureState, CaptureCopy> = {
  seek: {
    icon: "seek",
    line: "Point at the first shelf tag",
    hint: "Line up one price tag inside the frame.",
    read: "— — —",
  },
  blur: {
    icon: "blur",
    line: "Hold still a moment",
    hint: "Rest your elbow on the shelf. I'll tell you the second I can read it.",
    read: "EGUSI 8.50",
    paused: true,
  },
  far: {
    icon: "far",
    line: "Come a little closer",
    hint: "About a hand's width from the tag. I can see the shelf, not the price.",
    read: "EGUSI 8.50",
    paused: true,
  },
  near: {
    icon: "near",
    line: "Back up a little",
    hint: "The whole tag needs to fit inside the frame.",
    read: "GARRI 12.00",
    paused: true,
  },
  tag: {
    icon: "tag",
    line: "This tag won't read",
    hint: "The light is bouncing off it. Tilt the phone a little, or move a step to the side.",
    read: "crayf… ?",
    paused: true,
    act: "Type this one in later",
  },
  good: {
    icon: "good",
    line: "Got it — egusi",
    hint: "$8.50 · saved to shelf 1",
    read: "EGUSI 8.50",
  },
  done: {
    icon: "done",
    line: "That's the whole shop",
    hint: "Six products saved, nothing left to redo.",
    read: "ALL CLEAR",
  },
};

export interface PassStep {
  state: CaptureState;
  ms: number;
  copy?: Partial<CaptureCopy>;
  /** Shelf index this frame saved a product to. */
  save?: number;
  /** Shelf index this frame failed on — booked as a redo. */
  miss?: number;
}

/** The scripted walk-through. Real capture is a vision-model concern (ONB-2). */
export const CAPTURE_PASS: PassStep[] = [
  { state: "seek", ms: 1400 },
  { state: "far", ms: 2000 },
  { state: "blur", ms: 1900 },
  { state: "good", ms: 1500, save: 0,
    copy: { line: "Got it — egusi", hint: "$8.50 · saved to shelf 1", read: "EGUSI 8.50", toast: "Egusi · $8.50 saved" } },
  { state: "seek", ms: 1000,
    copy: { line: "Pan slowly to the right", hint: "Same distance. One tag at a time." } },
  { state: "good", ms: 1500, save: 0,
    copy: { line: "Got it — garri", hint: "$12.00 · saved to shelf 1", read: "GARRI 12.00", toast: "Garri · $12.00 saved" } },
  { state: "near", ms: 1800, copy: { read: "PALM OI" } },
  { state: "tag", ms: 2700, miss: 1, copy: { read: "p?lm 1S.3O" } },
  { state: "blur", ms: 1500, copy: { read: "PALM OIL 15.30" } },
  { state: "good", ms: 1500, save: 1,
    copy: { line: "Got it — red palm oil", hint: "$15.30 · saved to shelf 2", read: "PALM OIL 15.30", toast: "Red palm oil · $15.30 saved" } },
  { state: "tag", ms: 2600, miss: 1,
    copy: { line: "This tag won't read", hint: "Handwritten and a little worn. Try one step to the side.", read: "cr?yf ?.60" } },
  { state: "good", ms: 1600, save: 2,
    copy: { line: "Got it — ata rodo", hint: "$6.75 · saved to shelf 3", read: "ATA RODO 6.75", toast: "Ata rodo · $6.75 saved" } },
];

/** The second pass over the shelf that needed one. */
export const REDO_PASS: PassStep[] = [
  { state: "seek", ms: 1100,
    copy: { line: "Shelf 2, one more time", hint: "Start at the left end. Stand a step to the side of the light." } },
  { state: "good", ms: 1500, save: 1,
    copy: { line: "Got it — ground crayfish", hint: "$9.60 · saved to shelf 2", read: "CRAYFISH 9.60", toast: "Ground crayfish · $9.60 saved" } },
  { state: "good", ms: 1600, save: 1,
    copy: { line: "Got it — plantain flour", hint: "$10.20 · saved to shelf 2", read: "PLANTAIN 10.20", toast: "Plantain flour · $10.20 saved" } },
  { state: "done", ms: 0, copy: { toast: "Shelf 2 is clear" } },
];

/** 0 = not filmed yet, 1 = captured, 2 = needs another pass. */
export type ShelfState = 0 | 1 | 2;
