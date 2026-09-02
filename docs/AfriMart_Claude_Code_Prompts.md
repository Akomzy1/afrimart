# AfriMart — Claude Code Build Prompts

How to use: put `CLAUDE.md`, the PRD, the Brand Guide, and the 11 exported prototype pages (see folder layout below) into the repo before your first prompt. Then paste the prompts in order, one per session turn, letting Claude Code finish and verify each before moving to the next. Every prompt below carries an explicit prototype-fidelity instruction — don't drop it even when a prompt seems to run long.

## Before Prompt 1: get the files in place

```
afrimart/
├── CLAUDE.md
└── docs/
    ├── AfriMart_PRD.docx
    ├── AfriMart_Brand_Guide.pdf
    ├── AfriMart_Claude_Design_Prompts.md
    ├── AfriMart_Relume_Prompts.md
    ├── AfriMart_Pitch.docx
    ├── brand/
    │   ├── afrimart-avatar-400.png
    │   ├── afrimart-mark-reversed-512.png
    │   └── afrimart-cover-1500x500.png
    └── prototype/
        ├── AfriMart Design System.html
        ├── AfriMart Buyer App.html
        ├── AfriMart Buyer - Browse and Product.html
        ├── AfriMart Buyer - Cart and Checkout.html
        ├── AfriMart Buyer - Cook.html
        ├── AfriMart Buyer - Boxes Tracking and Account.html
        ├── AfriMart Merchant.html
        ├── AfriMart Merchant - Onboarding.html
        ├── AfriMart Logo Downloads.html
        ├── AfriMart Logo and Social Kit.html
        ├── AfriMart Logo Directions.html
        ├── Design system files/
        └── assets/
```

If any prototype page hasn't been exported yet, export it from Claude Design before starting — don't let Claude Code start buyer or merchant screens without the matching page in `docs/prototype/`.

---

## Prompt 1 — Orientation and plan (no code yet)

Read `CLAUDE.md` in full, then `/docs/AfriMart_PRD.docx`, then every file in `/docs/prototype/`, starting with `AfriMart Design System.html`. Do not write any code yet.

Once you've read them, report back: a one-paragraph summary of what AfriMart is, the monorepo structure you'll scaffold, the tech stack you'd recommend for each part (buyer PWA, merchant PWA, backend, database, shipping API integration, payments) with a one-line reason for each choice, and which PRD requirements map to which prototype page. Flag anything in the PRD or prototypes that looks inconsistent or ambiguous before we proceed.

This build is locked to the prototypes: the exported HTML pages in `/docs/prototype/` are the visual specification, not a style reference to loosely draw from. Confirm you understand that distinction before we start scaffolding.

---

## Prompt 2 — Scaffold the monorepo and design system

Scaffold the monorepo per the structure in `CLAUDE.md`: `apps/buyer`, `apps/merchant`, `packages/ui`, `packages/api-client`, `packages/shared`, `services/backend`. Use the stack we agreed in the previous step.

Build `packages/ui` directly from `/docs/prototype/AfriMart Design System.html` and the `Design system files/` folder: extract every token (colours, type scale, spacing, radii, shadows) and every reusable component (buttons, cards, badges, inputs, navigation) shown there, and implement them as the shared component library. Do not invent tokens or components that aren't present in the design system page or the Brand Guide — if something is missing that you need, stop and ask rather than guessing a value.

Cross-check every colour against the Brand Guide table in `CLAUDE.md` before committing it.

---

## Prompt 3 — Buyer app: shell and core browse/product screens

Build the buyer app shell and its entry point from `AfriMart Buyer App.html`, then the browse, category, search, and product detail screens from `AfriMart Buyer - Browse and Product.html`.

This is a prototype-locked build: match that page's layout, component choices, hierarchy, and content structure exactly, using only components from `packages/ui`. Do not add, remove, or rearrange sections that exist in the prototype. Where the prototype shows a desktop layout, implement it responsively alongside the mobile layout it also shows; where only one is shown, ask before assuming the other.

Wire it to real data using `packages/shared` types and `packages/api-client`, per PRD sections 6.3 and 6.4 (catalogue and canonical resolution, discovery and search).

When you're done, list any place you deviated from the prototype and why.

---

## Prompt 4 — Buyer app: cart, checkout, and Cook

Build cart and checkout from `AfriMart Buyer - Cart and Checkout.html`, and the Cook agent surface from `AfriMart Buyer - Cook.html`. Same prototype-lock rule as before: match the exported page exactly, using `packages/ui` components only.

Pay particular attention to fidelity on these PRD-critical behaviours, and confirm the prototype reflects each one correctly before you build it — flag it rather than silently fixing it if it doesn't:
- Single-store-preferring routing and the mandatory temperature split (PRD CART-2, CART-3)
- One total shown to the buyer, never two shipping fees, with the multi-parcel arrival clearly disclosed (CART-5, CART-6)
- The Cook agent is reachable and usable, but never blocks or gates standard cart/checkout (Product principles: "Cook is optional, never a gate")

---

## Prompt 5 — Buyer app: boxes, tracking, and account

Build the remaining buyer screens from `AfriMart Buyer - Boxes Tracking and Account.html`: Taste of Home boxes, order tracking, and account/order history. Prototype-locked, `packages/ui` only, same as prior prompts.

Make one-tap reorder from order history a first-class, prominent action per the prototype and PRD SRCH-4 — this is the retention mechanic the whole product depends on, so don't bury it.

---

## Prompt 6 — Merchant app: shell and order fulfilment

Build the merchant app from `AfriMart Merchant.html`: the three-tab shell (Camera, Orders, Messages) and the order inbox / fulfilment flow. Prototype-locked.

This app has a stricter constraint than the buyer app: exactly three navigation surfaces, large tap targets, minimal text, mobile-only. If you're tempted to add a settings screen, a dashboard, or any fourth navigation item because it would be "useful," don't — re-read `CLAUDE.md`'s merchant-simplicity principle and the prototype instead. Do not build a desktop layout for this app.

Use `packages/ui` components, but expect this app to use them at a different scale/density than the buyer app dials — that's expected and matches the prototype, not a deviation to flag.

---

## Prompt 7 — Merchant app: onboarding

Build the merchant onboarding flow from `AfriMart Merchant - Onboarding.html`: the choice between shelf-filming and website-import, guided capture, and catalogue review. Prototype-locked, same rules as Prompt 6.

Wire this to PRD section 6.1 (ONB-1 through ONB-8) for the actual onboarding logic and phase tags — build the Phase 1 rails (filming, structured import, human review) now; stub or skip the Phase 2 items (AI extraction fallback, two-way sync) per the phase discipline in `CLAUDE.md`.

---

## Prompt 8 — Backend: catalogue, orders, and routing engine

Build out `services/backend` to support everything the five prior prompts now call: the canonical product catalogue and name-resolution graph (PRD 6.3), the single-store-preferring routing and checkout logic (6.5), payments and marketplace splitting (6.7), and the multi-carrier shipping integration (6.8, and Appendix B if present in the PRD).

There is no prototype for backend logic — build this from the PRD requirement IDs directly, and implement the routing engine's behaviour exactly as specified: fill from one store first, split only when no single store can complete the order, disclose multi-parcel arrivals, absorb cost under the free-shipping threshold.

---

## Prompt 9 — Operations console (no prototype — build from PRD)

Build the internal operations console from PRD section 6.11. No prototype page exists for this yet, so follow the PRD's prose, and construct its screens using the same `packages/ui` design system already established — do not introduce a different visual style for internal tooling. Keep it functional and plain; this is not a customer-facing surface and doesn't need the same polish investment as the buyer or merchant apps.

---

## Prompt 10 — Prototype fidelity audit (run after Prompts 3–7)

Now that the buyer and merchant apps are built, do a fidelity pass: open each of the six functional prototype pages (Browse and Product, Cart and Checkout, Cook, Boxes Tracking and Account, Merchant, Merchant Onboarding) side by side with what you built, screen by screen. For each, report: matches / minor deviation / major deviation, with a one-line reason for anything not a clean match. Fix any major deviations before we continue. Also confirm every component used across both apps traces back to `packages/ui` — flag any one-off component built outside the shared system, since that's a sign of drift from the design system rather than a real one-off need.

---

## Notes for whoever is running these

- Don't skip Prompt 1. Letting Claude Code scaffold before it's read the PRD and every prototype page is the most common way a build drifts from spec in the first hour.
- If a session runs long and quality seems to slip, start a fresh session and re-open with: "Continue the AfriMart build. Read CLAUDE.md and re-check your work against `/docs/prototype/` before continuing" — this re-anchors it the same way the checkpoint pattern worked for the Claude Design sessions.
- Prompt 10 isn't optional polish — run it once the core buyer and merchant screens exist, not just at the very end, so drift gets caught early rather than compounding across every subsequent screen.
