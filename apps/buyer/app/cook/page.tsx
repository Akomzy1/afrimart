"use client";

import { useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  PageHeader,
  ProductGlyph,
  CookPotIcon,
  ArrowRightIcon,
  TruckIcon,
  CartIcon,
  useToast,
} from "@afrimart/ui";
import { useCart, FREE_SHIPPING_THRESHOLD_CENTS } from "../cart-context";
import { RECIPES, RECIPE_SUBTITLES, type Recipe } from "./recipes";

const money = (cents: number) => `$${(cents / 100).toFixed(2)}`;

/** Renders the prototype's **bold** spans without dangerouslySetInnerHTML. */
function emphasise(text: string): ReactNode[] {
  return text.split(/\*\*(.+?)\*\*/g).map((part, i) => (i % 2 ? <b key={i}>{part}</b> : part));
}

interface Turn {
  id: number;
  question: string;
  recipe: Recipe | null;
}

/**
 * AfriMart Buyer - Cook.html — Phase 1 recipe-to-cart (AGT-2/3/4).
 * Not built here, all Phase 2 and none prototyped: Plan an Event (AGT-8..13),
 * cook-along follow-up (AGT-7), cuisine personalization (AGT-14).
 */
export default function CookPage() {
  const router = useRouter();
  const { addByNames } = useCart();
  const { show } = useToast();
  const [turns, setTurns] = useState<Turn[]>([]);
  const [draft, setDraft] = useState("");
  const [thinking, setThinking] = useState(false);
  const nextId = useRef(0);

  function ask(question: string) {
    const q = question.trim();
    if (!q) return;
    const match =
      RECIPES.find((r) => q.toLowerCase().includes(r.key)) ??
      RECIPES.find((r) => r.query.toLowerCase() === q.toLowerCase()) ??
      null;
    const id = nextId.current++;
    setTurns((prev) => [...prev, { id, question: q, recipe: null }]);
    setDraft("");
    setThinking(true);
    window.setTimeout(() => {
      setTurns((prev) => prev.map((t) => (t.id === id ? { ...t, recipe: match } : t)));
      setThinking(false);
    }, 700);
  }

  const latestBasket = [...turns].reverse().find((t) => t.recipe)?.recipe ?? null;

  function basketFor(recipe: Recipe) {
    const subtotal = recipe.items.reduce((s, i) => s + i.priceCents * i.qty, 0);
    const remaining = Math.max(0, FREE_SHIPPING_THRESHOLD_CENTS - subtotal);
    const pct = Math.min(100, Math.round((subtotal / FREE_SHIPPING_THRESHOLD_CENTS) * 100));
    return (
      <div className="basket">
        <div className="bh">
          <div className="t">{recipe.title}</div>
          <div className="c">{recipe.items.length} ingredients</div>
        </div>

        {recipe.items.map((item) => (
          <div className="brow" key={item.name}>
            <div className="th">
              <ProductGlyph kind={item.glyph} />
            </div>
            <div className="m">
              <div className="nm">{item.name}</div>
              <div className="alt">
                {item.altNames} · ×{item.qty}
              </div>
              {item.substitution && <div className="sub">{item.substitution}</div>}
              <div className="ctrl">
                <div className="price">{money(item.priceCents * item.qty)}</div>
              </div>
            </div>
          </div>
        ))}

        <div className="arrival">
          <TruckIcon />
          <p>{emphasise(recipe.arrival)}</p>
        </div>

        <div className="btotal">
          <div className="r">
            <span>Subtotal</span>
            <span className="v">{money(subtotal)}</span>
          </div>
          <div className={`free${remaining === 0 ? " done" : ""}`}>
            {remaining === 0 ? "Free shipping unlocked" : `${money(remaining)} away from free shipping`}
          </div>
          <div className="track">
            <div className={`fill${remaining === 0 ? " done" : ""}`} style={{ width: `${pct}%` }} />
          </div>
          <div className="tot">
            <span className="l">Total</span>
            <span className="v">{money(subtotal)}</span>
          </div>
        </div>

        <div className="bact">
          <button
            type="button"
            className="addall"
            onClick={async () => {
              // AGT-4 — the recipe knows what it wants by name; the catalogue
              // resolves each to a listing and routing places it. Ingredients
              // the market doesn't carry are reported, not silently dropped.
              const qtyByName = Object.fromEntries(recipe.items.map((i) => [i.name, i.qty]));
              const { added, missing } = await addByNames(
                recipe.items.map((i) => i.name),
                qtyByName,
              );
              show(
                missing.length
                  ? `${added} of ${recipe.items.length} added — we don't carry ${missing.slice(0, 2).join(" or ")} yet`
                  : `${recipe.title} added to cart`,
              );
              if (added) router.push("/cart");
            }}
          >
            <CartIcon /> Add all to cart
          </button>
          {/* AGT-1 — Cook accelerates, never gates: browsing is always right there. */}
          <div className="reassure">
            or <Link href="/shop">keep browsing the market</Link>
          </div>
        </div>
      </div>
    );
  }

  return (
    <>
      <div className="mobile-chrome">
        <PageHeader back="/" eyebrow="Cook" title="Your kitchen agent" />
      </div>

      <div className="cook-layout">
        <div className="cook-main">
          <div className="conv">
            {turns.length === 0 && (
              <div className="opening">
                <div className="mark">
                  <CookPotIcon />
                </div>
                <h1>What are you cooking, and for how many?</h1>
                <p>
                  Tell me the dish and the number of mouths, and I&apos;ll fill your cart — with the right quantities, from
                  sellers who ship together.
                </p>
                <div className="exlabel">Try one of these</div>
                <div className="exchips">
                  {RECIPES.map((r) => (
                    <button key={r.key} type="button" className="exchip" onClick={() => ask(r.query)}>
                      <div>
                        <div className="t">{r.headline}</div>
                        <div className="s">{RECIPE_SUBTITLES[r.key]}</div>
                      </div>
                      <span className="go">
                        <ArrowRightIcon />
                      </span>
                    </button>
                  ))}
                </div>
              </div>
            )}

            {turns.map((turn) => (
              <div key={turn.id} style={{ display: "contents" }}>
                <div className="msg-user">{turn.question}</div>
                {turn.recipe && (
                  <div className="msg-agent">
                    <div className="av">
                      <CookPotIcon />
                    </div>
                    <div className="content">
                      <div className="say">{turn.recipe.say}</div>
                      {basketFor(turn.recipe)}
                    </div>
                  </div>
                )}
                {!turn.recipe && !thinking && (
                  <div className="msg-agent">
                    <div className="av">
                      <CookPotIcon />
                    </div>
                    <div className="content">
                      <div className="say">
                        I don&apos;t have that one written down yet. Try jollof, egusi or doro wat — or{" "}
                        <Link href="/shop">browse the market</Link> and I&apos;ll stay out of your way.
                      </div>
                    </div>
                  </div>
                )}
              </div>
            ))}

            {thinking && (
              <div className="msg-agent">
                <div className="av">
                  <CookPotIcon />
                </div>
                <div className="content">
                  <div className="dots" aria-label="Cook is thinking">
                    <i />
                    <i />
                    <i />
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="composer">
            <div className="box">
              <textarea
                rows={1}
                value={draft}
                placeholder="Jollof rice for eight…"
                aria-label="Tell Cook what you're making"
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) {
                    e.preventDefault();
                    ask(draft);
                  }
                }}
              />
              <button type="button" className="send" onClick={() => ask(draft)} aria-label="Send">
                <ArrowRightIcon />
              </button>
            </div>
            <div className="hint">Cook suggests quantities and sellers — you always approve the cart.</div>
          </div>
        </div>

        {/* Desktop-only basket rail; below 1200px the basket sits inline in the thread. */}
        <aside className="basketPanel">
          <div className="bp-title">Your basket</div>
          {latestBasket ? (
            basketFor(latestBasket)
          ) : (
            <div className="bp-empty">Ask for a dish and I&apos;ll gather the ingredients here.</div>
          )}
        </aside>
      </div>
    </>
  );
}
