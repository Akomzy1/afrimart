"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  LogoMark,
  ProductGlyph,
  CheckIcon,
  ChevronLeftIcon,
  LockIcon,
  TruckIcon,
  CookPotIcon,
  ShipCheckIcon,
  SealIcon,
  RedoIcon,
  type ProductGlyphKind,
} from "@afrimart/ui";
import {
  CAPTURE_STATES,
  CAPTURE_PASS,
  REDO_PASS,
  type CaptureState,
  type CaptureCopy,
  type PassStep,
  type ShelfState,
} from "./capture";

type Step = "welcome" | "code" | "path" | "film" | "connect" | "review" | "live";
type Path = "film" | "web";

interface DraftProduct {
  name: string;
  meta: string;
  priceCents: number;
  glyph: ProductGlyphKind;
}

/** ONB-2 — what vision cataloguing extracts: name, pack size, shelf-tag price. */
const DRAFT: DraftProduct[] = [
  { name: "Egusi", meta: "Ground melon seeds · 500g", priceCents: 850, glyph: "leaf" },
  { name: "Garri", meta: "Cassava flakes · 2kg", priceCents: 1200, glyph: "wheat" },
  { name: "Red Palm Oil", meta: "Cold-pressed · 1L", priceCents: 1530, glyph: "jar" },
  { name: "Ata Rodo", meta: "Scotch bonnet · 250g", priceCents: 675, glyph: "pepper" },
  { name: "Crayfish", meta: "Ground · 150g", priceCents: 780, glyph: "seed" },
  { name: "Berbere", meta: "Fresh-blended · 250g", priceCents: 990, glyph: "seed" },
];

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;
const STEP_ORDER: Step[] = ["welcome", "code", "path", "film", "review", "live"];

/**
 * AfriMart Merchant - Onboarding.html — PRD 6.1.
 *
 * Built (Phase 1): ONB-1 adaptive routing, ONB-2 capture, ONB-3 unusable-frame
 * detection and re-shoot (see ./capture.ts), ONB-4 website import, ONB-6
 * human-in-the-loop review, ONB-8 kit issuance and hub assignment.
 * Not built (Phase 2): ONB-5 AI extraction fallback, ONB-7 two-way sync.
 */
export default function OnboardingPage() {
  const router = useRouter();
  const [step, setStep] = useState<Step>("welcome");
  const [phone, setPhone] = useState("");
  const [code, setCode] = useState(["", "", "", ""]);
  const [path, setPath] = useState<Path | null>(null);
  const [site, setSite] = useState("");
  const [importing, setImporting] = useState(false);
  // ONB-3 capture state. `saved` only counts frames that actually captured a
  // product; anything unusable lands in `redo` instead.
  const [capState, setCapState] = useState<CaptureState>("seek");
  const [capCopy, setCapCopy] = useState<CaptureCopy>(CAPTURE_STATES.seek);
  const [saved, setSaved] = useState(0);
  const [redo, setRedo] = useState(0);
  const [shelves, setShelves] = useState<ShelfState[]>([0, 0, 0]);
  const [currentShelf, setCurrentShelf] = useState(0);
  const [noted, setNoted] = useState<string | null>(null);
  const [reshootOpen, setReshootOpen] = useState(false);
  const passTimer = useRef<number | null>(null);
  const noteTimer = useRef<number | null>(null);
  const [products, setProducts] = useState<DraftProduct[]>(DRAFT);
  const [editing, setEditing] = useState<number | null>(null);
  const otpRefs = useRef<(HTMLInputElement | null)[]>([]);

  /**
   * Walks a capture pass. A step carrying `save` books a product; one carrying
   * `miss` books a redo against its shelf — never a save. Nothing here can
   * increment the counter on a frame the model rejected.
   */
  function runPass(pass: PassStep[], index: number) {
    const stepDef = pass[index];
    if (!stepDef) {
      setReshootOpen(true);
      return;
    }
    setCapState(stepDef.state);
    setCapCopy({ ...CAPTURE_STATES[stepDef.state], ...stepDef.copy });

    if (typeof stepDef.save === "number") {
      const shelf = stepDef.save;
      setCurrentShelf(shelf);
      setSaved((n) => n + 1);
      setShelves((prev) => prev.map((s, i) => (i === shelf && s !== 2 ? 1 : s)));
    }
    if (typeof stepDef.miss === "number") {
      const shelf = stepDef.miss;
      setCurrentShelf(shelf);
      noteTimer.current = window.setTimeout(() => {
        setRedo((n) => n + 1);
        setShelves((prev) => prev.map((s, i) => (i === shelf ? 2 : s)));
        setNoted(`Kept a note — shelf ${shelf + 1} needs one more pass`);
        window.setTimeout(() => setNoted(null), 1600);
      }, Math.max(stepDef.ms - 900, 300));
    }

    if (stepDef.ms > 0) {
      passTimer.current = window.setTimeout(() => runPass(pass, index + 1), stepDef.ms);
    }
  }

  useEffect(() => {
    if (step !== "film") return;
    setSaved(0);
    setRedo(0);
    setShelves([0, 0, 0]);
    setCurrentShelf(0);
    setReshootOpen(false);
    runPass(CAPTURE_PASS, 0);
    return () => {
      if (passTimer.current) window.clearTimeout(passTimer.current);
      if (noteTimer.current) window.clearTimeout(noteTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  /** Re-film only the shelf that needs it; everything already saved stays saved. */
  function startRedoPass() {
    setReshootOpen(false);
    setRedo(0);
    setShelves((prev) => prev.map((s, i) => (i === 1 ? 0 : s)));
    setCurrentShelf(1);
    runPass(REDO_PASS, 0);
  }

  function enterCode(index: number, value: string) {
    const digit = value.replace(/\D/g, "").slice(-1);
    const next = [...code];
    next[index] = digit;
    setCode(next);
    if (digit && index < 3) otpRefs.current[index + 1]?.focus();
    if (next.every((d) => d)) window.setTimeout(() => setStep("path"), 260);
  }

  function startImport() {
    setImporting(true);
    window.setTimeout(() => {
      setImporting(false);
      setStep("review");
    }, 1600);
  }

  const stepIndex = Math.max(0, STEP_ORDER.indexOf(step === "connect" ? "film" : step));

  // ---- welcome (phone) ----
  if (step === "welcome") {
    return (
      <div className="mr-shell mr-onb">
        <div className="mr-onb-dark">
          <div className="wm">
            <LogoMark tone="on-dark" size={30} />
            <span>
              Afri<span className="m">Mart</span>
            </span>
          </div>
          <div className="mr-onb-hero">
            <p className="eyebrow">Become a seller</p>
            <h1 className="serif">You stock the shelf. We handle the rest.</h1>
            <div className="sub">Sell what you know, to everyone who misses it — across America.</div>
          </div>
          <div className="mr-onb-form">
            <label htmlFor="onb-phone">Your phone number</label>
            <div className="mr-phone-in">
              <span className="flag">🇺🇸 +1</span>
              <input
                id="onb-phone"
                inputMode="numeric"
                maxLength={14}
                placeholder="(555) 123 4567"
                value={phone}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
            <div className="mr-onb-note">We&apos;ll text you a code. No passwords to remember.</div>
          </div>
        </div>
        <div className="mr-actionbar">
          <button
            type="button"
            className={`mr-bigbtn ${phone.replace(/\D/g, "").length >= 10 ? "accent" : "disabled"}`}
            disabled={phone.replace(/\D/g, "").length < 10}
            onClick={() => setStep("code")}
          >
            Send my code
          </button>
        </div>
      </div>
    );
  }

  // ---- live (final) ----
  if (step === "live") {
    return (
      <div className="mr-shell mr-onb">
        <div className="mr-live">
          <div className="seal">
            <div className="ring" />
            <div className="ring2" />
            <div className="core">
              <CheckIcon strokeWidth={2.4} />
            </div>
          </div>
          <p className="eyebrow">You&apos;re live</p>
          <h1 className="serif">Your store is open to all of America.</h1>
          <div className="sub">Buyers can find you now. We&apos;ll send your first order to your phone.</div>
          <div className="count">
            <b>{products.length}</b> products listed · Mama Ngozi, Bronx
          </div>

          {/* ONB-8 — kit issuance and hub assignment, recorded at go-live. */}
          <div className="mr-kit">
            <div className="kh">Your onboarding kit</div>
            <div className="mr-kitrow">
              <span className="ic">
                <ShipCheckIcon />
              </span>
              <span className="m">
                <span className="t">Packaging issued</span>
                <span className="s">Boxes and tape · arriving Thursday</span>
              </span>
            </div>
            <div className="mr-kitrow">
              <span className="ic">
                <SealIcon />
              </span>
              <span className="m">
                <span className="t">Label printer issued</span>
                <span className="s">Serial AM-LP-2291 · set up on arrival</span>
              </span>
            </div>
            <div className="mr-kitrow">
              <span className="ic">
                <TruckIcon />
              </span>
              <span className="m">
                <span className="t">Supply hub assigned</span>
                <span className="s">Bronx, NY · daily carrier pickup</span>
              </span>
            </div>
          </div>
        </div>
        <div className="mr-actionbar">
          <button type="button" className="mr-bigbtn accent" onClick={() => router.push("/")}>
            Go to my orders
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mr-shell mr-onb">
      <div className="mr-header">
        <button
          type="button"
          className="back"
          aria-label="Back"
          onClick={() => {
            const order: Step[] = ["welcome", "code", "path", path === "web" ? "connect" : "film", "review"];
            const i = order.indexOf(step);
            setStep(i > 0 ? order[i - 1] : "welcome");
          }}
        >
          <ChevronLeftIcon />
        </button>
        <h2 className="serif">
          {step === "code" ? "Verify" : step === "path" ? "Get started" : step === "review" ? "Your catalogue" : "Set up"}
        </h2>
      </div>

      <div className="mr-onb-steps">
        {STEP_ORDER.slice(0, 5).map((s, i) => (
          <div className={`s${i <= stepIndex ? " on" : ""}`} key={s} />
        ))}
      </div>

      <div className="mr-scroll">
        {step === "code" && (
          <div className="mr-onb-content">
            <div className="mr-onb-head">
              <h1 className="serif">Enter your code</h1>
              <p>We texted a 4-digit code to your phone.</p>
            </div>
            <div className="mr-otp">
              {code.map((d, i) => (
                <input
                  key={i}
                  ref={(el) => {
                    otpRefs.current[i] = el;
                  }}
                  inputMode="numeric"
                  maxLength={1}
                  className={d ? "filled" : ""}
                  value={d}
                  aria-label={`Digit ${i + 1}`}
                  onChange={(e) => enterCode(i, e.target.value)}
                />
              ))}
            </div>
            <div className="mr-onb-resend">
              Didn&apos;t get it? <b>Resend code</b>
            </div>
          </div>
        )}

        {/* ONB-1 — the adaptive fork: filming rail or structured import rail. */}
        {step === "path" && (
          <div className="mr-onb-content">
            <div className="mr-onb-head">
              <h1 className="serif">How would you like to start?</h1>
              <p>Either way takes a few minutes.</p>
            </div>
            <div className="mr-paths">
              <button
                type="button"
                className={`mr-pathcard film${path === "film" ? " on" : ""}`}
                onClick={() => setPath("film")}
                aria-pressed={path === "film"}
              >
                <span className="ic">
                  <CookPotIcon />
                </span>
                <span className="m">
                  <span className="t">Film your shelves</span>
                  <span className="s">Walk your store with the camera. We&apos;ll build your catalogue.</span>
                  <span className="badge">Most sellers start here</span>
                </span>
              </button>
              <button
                type="button"
                className={`mr-pathcard web${path === "web" ? " on" : ""}`}
                onClick={() => setPath("web")}
                aria-pressed={path === "web"}
              >
                <span className="ic">
                  <ShipCheckIcon />
                </span>
                <span className="m">
                  <span className="t">Connect your website</span>
                  <span className="s">We&apos;ll bring your products across automatically.</span>
                </span>
              </button>
            </div>
          </div>
        )}

        {/* ONB-2 — guided capture. */}
        {step === "film" && (
          <div className={`mr-onb-film mr-fw s-${capState}${capCopy.paused ? " paused" : ""}${noted ? " noted" : ""}`}>
            <div className="mr-filmview">
              {/* Stand-in for the camera feed; the states act on it so the
                  failure is visible rather than described. */}
              <div className="mr-lens">
                {[0, 1, 2].map((b) => (
                  <div className="mr-band" key={b}>
                    <i /><i /><i /><i />
                    <b>{["EGUSI 8.50", "PALM OIL 15.30", "ATA RODO 6.75"][b]}</b>
                  </div>
                ))}
              </div>
              <div className="scan" />
              <div className="corner c1" />
              <div className="corner c2" />
              <div className="corner c3" />
              <div className="corner c4" />
              <div className="mr-edge" />

              <div className="mr-hud">
                <div className="row">
                  <div className="mr-pill rec">
                    <span className="dot" /> {capCopy.paused ? "PAUSED — NOT SAVING" : "REC"}
                  </div>
                  <div className="mr-pill saved">
                    <b>{saved}</b> saved
                  </div>
                  {redo > 0 && (
                    <div className="mr-pill redo">
                      <RedoIcon /> {redo} to redo
                    </div>
                  )}
                </div>
                <div className="mr-strip">
                  {shelves.map((s, i) => (
                    <div className={`mr-seg${s === 1 ? " done" : s === 2 ? " redo" : i === currentShelf ? " now" : ""}`} key={i}>
                      {s === 1 && <CheckIcon strokeWidth={2.6} />}
                      {s === 2 && <RedoIcon />}
                      Shelf {i + 1}
                    </div>
                  ))}
                </div>
                <div className="mr-readout">
                  <div className="lb">Tag reading</div>
                  <div className="val">{capCopy.read}</div>
                </div>
              </div>

              <div className="mr-gotit">
                <CheckIcon strokeWidth={2.6} /> {capCopy.toast ?? "Saved"}
              </div>
              <div className="mr-missnote">
                <RedoIcon /> {noted}
              </div>
            </div>

            <div className="mr-coachcard">
              <span className="ic">
                <CaptureIcon state={capCopy.icon} />
              </span>
              <div className="m">
                <div className="t">{capCopy.line}</div>
                <div className="h">{capCopy.hint}</div>
                {capCopy.act && (
                  <button type="button" className="act on" onClick={() => setNoted("We'll ask you for this one at review")}>
                    {capCopy.act}
                  </button>
                )}
              </div>
            </div>
          </div>
        )}

        {/* ONB-4 — website import, detection-first. */}
        {step === "connect" && (
          <div className="mr-onb-content">
            {importing ? (
              <div className="mr-importing">
                <div className="spin" />
                <div className="t serif">Reading your store…</div>
                <div className="s">Found a product feed — bringing them across.</div>
              </div>
            ) : (
              <>
                <div className="mr-onb-head">
                  <h1 className="serif">Connect your store</h1>
                  <p>Paste your website and we&apos;ll bring your products in.</p>
                </div>
                <div className="mr-gfield" style={{ marginTop: 20 }}>
                  <label htmlFor="onb-site">Your website</label>
                  <div className="in">
                    <span className="pre">https://</span>
                    <input id="onb-site" placeholder="mamangozi.shop" value={site} onChange={(e) => setSite(e.target.value)} autoComplete="off" />
                  </div>
                </div>
                <div className="mr-connect-note">
                  <LockIcon />
                  <span>We only read your product names, photos and prices. Nothing else.</span>
                </div>
              </>
            )}
          </div>
        )}

        {/* ONB-6 — the owner corrects the draft before anything publishes. */}
        {step === "review" && (
          <div className="mr-onb-content">
            <div className="mr-onb-head">
              <h1 className="serif">Check your catalogue</h1>
              <p>We found these. Fix anything that looks off.</p>
            </div>
            <div className="mr-review-hint">
              <CheckIcon /> Tap any product to correct its name or price.
            </div>
            <div className="mr-rtiles">
              {products.map((p, i) => (
                <div className="mr-rtile" key={p.name}>
                  <div className="pic">
                    <ProductGlyph kind={p.glyph} />
                  </div>
                  <div className="b">
                    {editing === i ? (
                      <>
                        <input
                          className="mr-edit-name"
                          value={p.name}
                          aria-label="Product name"
                          onChange={(e) =>
                            setProducts((prev) => prev.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))
                          }
                          style={{ width: "100%", height: 40, border: "2px solid var(--green)", borderRadius: "var(--r-sm)", padding: "0 8px", fontSize: 16, outline: 0 }}
                        />
                        <div className="mr-editrow">
                          <button type="button" className="edit" onClick={() => setEditing(null)}>
                            <CheckIcon /> Done
                          </button>
                        </div>
                      </>
                    ) : (
                      <>
                        <div className="nm">{p.name}</div>
                        <div className="meta">{p.meta}</div>
                        <div className="price tnum">{money(p.priceCents)}</div>
                        <button type="button" className="edit" onClick={() => setEditing(i)}>
                          <CheckIcon /> Fix this
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
        <div className="mr-spacer" />
      </div>

      <div className="mr-actionbar">
        {step === "code" && <div className="mr-barhint">Enter the code to continue</div>}
        {step === "path" && (
          <button
            type="button"
            className={`mr-bigbtn ${path ? "accent" : "disabled"}`}
            disabled={!path}
            onClick={() => setStep(path === "web" ? "connect" : "film")}
          >
            Continue
          </button>
        )}
        {step === "film" && (
          <>
            <button
              type="button"
              className={`mr-bigbtn ${saved > 0 ? "accent" : "disabled"}`}
              disabled={saved === 0}
              onClick={() => (redo > 0 ? setReshootOpen(true) : setStep("review"))}
            >
              <CheckIcon strokeWidth={2.6} /> Done filming
            </button>
            <div className="mr-barhint">
              {saved} saved{redo > 0 ? ` · ${redo} still to redo` : ""}
            </div>
          </>
        )}
        {step === "connect" && !importing && (
          <button
            type="button"
            className={`mr-bigbtn ${site.trim() ? "accent" : "disabled"}`}
            disabled={!site.trim()}
            onClick={startImport}
          >
            Bring my products in
          </button>
        )}
        {step === "review" && (
          <>
            <button type="button" className="mr-bigbtn green" onClick={() => setStep("live")}>
              <CheckIcon strokeWidth={2.6} /> Publish {products.length} products
            </button>
            <div className="mr-barhint">Nothing goes live until you tap this</div>
          </>
        )}
      </div>

      {/* The re-shoot ask: what's safe first, then the request, then a way out. */}
      {reshootOpen && (
        <div className="mr-sheet on">
          <div className="scrim" onClick={() => setReshootOpen(false)} />
          <div className="card">
            <div className="ic">
              <RedoIcon />
            </div>
            <p className="eyebrow">One more pass</p>
            <h2 className="serif">Shelf 2 could use a second look.</h2>
            <p>
              Two tags there were too shiny to read. That corner catches the light — it happens to everyone. Stand a step
              to the side and film just that shelf.
            </p>
            <div className="safe">
              <CheckIcon strokeWidth={2.2} /> Your {saved} other products are already saved.
            </div>
            <div className="btns">
              <button type="button" className="mr-bigbtn green" onClick={startRedoPass}>
                Film shelf 2 again
              </button>
              <button type="button" className="ghost" onClick={() => { setReshootOpen(false); setStep("review"); }}>
                I&apos;ll type those two in
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * One glyph per capture verdict — the frame's tone colour carries the rest.
 *
 * Stays local rather than moving to `packages/ui`: it switches on
 * `CaptureState`, a type that only means anything inside this flow, so sharing
 * it would drag the onboarding state machine into the design system. The
 * generic icons it would otherwise duplicate (check, redo) come from there.
 */
function CaptureIcon({ state }: { state: CaptureState }) {
  const common = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: 1.9 } as const;
  if (state === "good" || state === "done") {
    return (
      <svg {...common} strokeWidth={2.6}>
        <path d="M20 6L9 17l-5-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "blur") {
    return (
      <svg {...common}>
        <path d="M3 3l18 18M10.6 10.7a2 2 0 0 0 2.7 2.7M9.4 5.6A9 9 0 0 1 21 12c-.7 1.1-1.5 2.1-2.4 2.9M6.4 8.3A16 16 0 0 0 3 12a9 9 0 0 0 12.2 4.6" strokeLinecap="round" />
      </svg>
    );
  }
  if (state === "far") {
    return (
      <svg {...common}>
        <path d="M9 15l-5 5M4 15v5h5M15 9l5-5M20 9V4h-5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "near") {
    return (
      <svg {...common}>
        <path d="M4 20l5-5M9 20H4v-5M20 4l-5 5M15 4h5v5" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  }
  if (state === "tag") {
    return (
      <svg {...common}>
        <path d="M20.6 13.4L13.4 20.6a2 2 0 0 1-2.8 0l-7.2-7.2A2 2 0 0 1 3 12V5a2 2 0 0 1 2-2h7a2 2 0 0 1 1.4.6l7.2 7.2a2 2 0 0 1 0 2.6z" strokeLinejoin="round" />
        <path d="M7.5 7.5h.01" strokeLinecap="round" />
      </svg>
    );
  }
  return (
    <svg {...common}>
      <circle cx="11" cy="11" r="7" />
      <path d="M21 21l-4-4" strokeLinecap="round" />
    </svg>
  );
}
