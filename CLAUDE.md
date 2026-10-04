# CLAUDE.md — AfriMart

This file orients any Claude Code session working on this repository. Read this first, then `/docs/AfriMart_PRD.md` for the full specification and `/docs/AfriMart_Claude_Design_Prompts.md` for the UI spec, before writing code.

## What this project is

AfriMart is a shipping-first, AI-powered marketplace for African groceries in the United States. African stores, home-based sellers, and aspiring food entrepreneurs list products; buyers anywhere in the US order and receive them by nationwide shipping. Full specification: `/docs/AfriMart_PRD.md`.

Read `/docs/AfriMart_Brand_Guide.pdf` before writing any UI. It defines the palette, type direction, and voice — treat its values as ground truth over anything approximate elsewhere.

## Source of truth hierarchy

1. **The PRD** (`/docs/AfriMart_PRD.md`) — functional requirements, phase tags, architecture, data model, release plan. Governs *what* to build and *how it behaves*. If this file and a prior conversation disagree, the PRD wins.
2. **The Claude Design prototypes** (`/docs/prototype/` — see "Design prompts and prototypes" below) — govern *how it looks and how screens are laid out*. Where the PRD describes a flow in prose, the exported prototype page is the actual visual spec for it: layout, hierarchy, density, and component choices. Build UI to match the prototype, not an independent interpretation of the PRD's prose.
3. **This file (CLAUDE.md)** — conventions, structure, and standing instructions for how to build, not what to build or how it looks.
4. **The Brand Guide** — palette, type, and voice truth; applies to every screen, prototyped or not.
5. Everything else (pitch, marketing plan) is context, not spec. Do not treat marketing copy as a functional or visual requirement.

If a screen exists in the prototype and in the PRD, build to the prototype's layout using the PRD's requirement IDs to confirm behavior (validation rules, states, data shown). If a screen or flow is in the PRD but was never prototyped, follow the PRD's prose and the established design system (tokens, components, patterns already used elsewhere in the prototype) rather than inventing a new visual language for it.

If a decision isn't covered by the PRD or the prototype, make the most reasonable call consistent with the product's stated principles below, and note the assumption in your response rather than blocking on it.

## Product principles (apply these when the PRD is silent)

- **Shipping-first, not local-delivery.** Never build or suggest same-day/local-delivery logic. The whole model depends on nationwide reach from hub stores.
- **Asset-light.** No inventory-holding, no warehouse logic, no fleet management. The platform orchestrates; carriers and stores fulfil.
- **Single-store-preferring routing.** When building cart/checkout logic, always try to fill a basket from one store before splitting across stores. Temperature (ambient vs. perishable) is a mandatory split; store-source is an optimised one.
- **One price, transparent parcels.** A buyer never sees two shipping fees on one order. Multi-parcel arrivals are always disclosed, never hidden.
- **Shipping at cost, never absorbed.** The buyer pays the actual calculated carrier cost (plus a cold-pack line at cost for chilled/frozen parcels). AfriMart runs no platform free-shipping threshold and does not absorb shipping on any category (PRD CART-5). The only exceptions are seller-funded free shipping (PAY-10) and the paid membership tier (SUB-3). Commission is charged on item value only, never on shipping (PAY-3).
- **Labels are always platform-issued; baskets can combine sellers.** Never build a flow where a seller buys their own label, and never restrict checkout to one seller. Both are deliberate defences against buyers and sellers bypassing the platform after the first order (FUL-9, CART-1).
- **PWA first.** Both buyer and merchant apps are progressive web apps. Do not scaffold native iOS/Android — that's an explicit Phase 3, success-gated decision.
- **Merchant simplicity is non-negotiable.** The merchant app has exactly three surfaces: Camera, Orders, Messages. Resist adding settings screens, dashboards, or extra navigation — usability for a low-digital-comfort store owner outranks feature completeness.
- **The AI agent (Cook) is optional, never a gate.** Standard search-and-cart must always work without touching the agent. Never make a flow depend on the conversational agent to complete a purchase.
- **Quality is engineered, not assumed.** Any seller-facing or product-listing feature should consider the quality layer (verification, packing-photo evidence, quality scoring) specified in PRD section 6.13 — don't build an unverified path to public listing.
- **Phase discipline.** Every PRD requirement is tagged Phase 1, 2, or 3. Do not build ahead of phase (e.g. cold-chain, consolidation, Canada, native apps, membership) unless explicitly asked to prototype it.

## Brand tokens

Use these exactly — do not approximate or invent adjacent shades.

| Token | Hex | Use |
|---|---|---|
| Market Green | `#1F3D2B` | Primary brand color, dominant surface/ground |
| Harvest Amber | `#E8A44D` | Accent — sparingly, for the single most important action per screen |
| Amber (text/heading-safe) | `#9C6B2E` | Darkened amber for readable text/headings on light backgrounds (raw `#E8A44D` is too pale for text) |
| Ivory | `#FAF5EE` | Background, warm off-white, not stark white |
| Ink | `#222222` | Body text |

Typography direction: a classic high-contrast serif for display/headlines, a clean humanist sans for UI and body text. Aesthetic: premium and classic — "heritage grocer," not discount e-commerce or generic startup. Voice: warm, plain-spoken, dignified, never salesy, no exclamation marks.

Logo files are in `/docs/brand/` (avatar, reversed mark, cover lockup). Use the avatar for small square placements (favicon, app icon); the full lockup where there's room to introduce the brand.

## Design prompts and prototypes

Both apps were designed before this build started, then built as clickable HTML prototypes in Claude Design. Treat the resulting prototypes as the UI spec.

**These are Claude Artifact bundle exports, not plain HTML.** Each file is a self-contained, standalone page that renders correctly in a browser — but internally it is a self-extracting bundle (a `<script type="__bundler/template">` tag holding the real page as a JSON-escaped string, plus a manifest of base64 fonts/images), so opening the raw file in a text editor shows loader boilerplate, not the design. For reading/reuse as a spec, use the already-extracted plain HTML in `/docs/prototype/extracted/` (one file per functional page, same filenames). If a prototype page is re-exported later, re-run that extraction before using it as a build reference.

**The prototype set contains these pages, all verified current** (colors and responsive layout confirmed correct as of the latest export):

| Prototype page | Covers | Responsive status |
|---|---|---|
| `AfriMart Design System.html` | Master tokens, type scale, components — read this first, it's the shared system both apps draw from | Reference page |
| `AfriMart Buyer App.html` | Buyer app shell / entry point, header, navigation | Mobile (≤480px), tablet (701–1199.98px), desktop (≥1200px) |
| `AfriMart Buyer - Browse and Product.html` | Homepage, shop/category browse, search results, product detail | Mobile, tablet, desktop |
| `AfriMart Buyer - Cart and Checkout.html` | Cart, checkout, order confirmation | Mobile, tablet, desktop |
| `AfriMart Buyer - Cook.html` | The Cook AI agent (recipe-to-cart) conversational surface | Mobile, tablet, desktop |
| `AfriMart Buyer - Boxes Tracking and Account.html` | Taste of Home boxes, order tracking, account/order history | Mobile, tablet, desktop |
| `AfriMart Merchant.html` | Merchant app shell — Camera / Orders / Messages, order fulfilment flow | Mobile only — deliberate, do not add desktop |
| `AfriMart Merchant - Onboarding.html` | Merchant onboarding: shelf-filming / website import, catalogue review | Mobile only — deliberate |
| `AfriMart Logo Downloads.html`, `AfriMart Logo and Social Kit.html` | Brand assets and usage — reference alongside the Brand Guide, not functional UI | Reference pages |

**Brand colors are confirmed correct across every page above: Market Green `#1F3D2B` and Harvest Amber `#E8A44D` only.** There is no terracotta in this brand — if you ever see `#C05621` in any file, treat it as a bug from an earlier prototype revision and flag it rather than propagating it; it should not appear in the current set.

**Get these into the repo before building UI.** Place all pages under `/docs/prototype/`, preserving the filenames above. If a page is missing or looks stale (e.g. still shows `#C05621`, or a buyer page has only a `max-width:480px` breakpoint with nothing above it), ask the person for a fresh export before building that screen — building from the PRD's prose alone when a real, current prototype page exists will produce a mismatched UI.

Rules for using them:

- **Read the actual HTML/CSS, not just a screenshot.** Each file shows real markup, spacing values, breakpoints, and component structure — treat it as closer to a spec than a picture of it. Match its layout, hierarchy, and component choices; adapt markup to the project's actual framework rather than copying HTML verbatim.
- **Start from `AfriMart Design System.html`.** It's the shared source for tokens, type, and components — build `packages/ui` from it before building individual screens, so buyer and merchant stay visually consistent by construction.
- **Match structure and hierarchy, not pixels.** Translate layout and emphasis faithfully (e.g. "one dominant Accept button," "large tap targets," a right-rail order summary); don't feel obligated to pixel-match spacing that a proper component library will naturally handle differently.
- **Buyer app is responsive across three tiers; merchant app is mobile-only, deliberately.** Build the buyer app's mobile, tablet, and desktop layouts all from what's in the prototype file — don't just implement mobile and call it done. Do not design a desktop merchant experience unless explicitly asked (see Product principles: merchant simplicity).
- **The two apps share one design system, applied differently.** Same tokens, type, and component DNA; the merchant app dials density down and tap targets up. Build a shared component once in `packages/ui`, not twice.
- **If a build decision and the prototype conflict** (e.g. a pattern is awkward in the chosen framework, or accessibility requires a change), prefer fidelity to the prototype's intent over its literal layout, and flag the deviation rather than silently drifting from it.
- **No prototype page exists yet for the operations console (6.11), the seller-verification/quality-assurance flows (6.13), Plan an Event (6.6, AGT-8 through AGT-13), or Community and Social Discovery (6.14, COM-1 through COM-4).** Plan an Event extends the existing Cook prototype (`AfriMart Buyer - Cook.html`) with a consolidated multi-dish list, an event-date field, and a share/approve action — none of which the current export covers, and it is Phase 2 regardless. Community and Social Discovery (recipe/menu sharing, authenticity ratings, creator content, following sellers) has no existing screen to extend and needs a new surface designed from scratch; COM-1/COM-2 are Phase 2, COM-3/COM-4 are Phase 3 — none of it is due before Phase 2 planning. Build all of these from the PRD's prose and the established design system until a prototype is provided.
- **Some Phase 1/2 additions piggyback on existing prototype pages rather than needing new ones — do not build these as new screens.** Authenticity/provenance badging (CAT-8) and vendor/product storytelling (CAT-9) are a badge and a text block added to the existing product and seller views in `AfriMart Buyer - Browse and Product.html`. Send-to-family gifting (SUB-5) is a recipient-address toggle and gift-note field added to the existing `AfriMart Buyer - Cart and Checkout.html`. Cuisine/dietary personalization (AGT-14) changes what the agent and search surface, not how any screen looks, and needs no visual treatment at all. Build these as small additions to the current prototype's layout and component style, not as standalone designs.

## Repository structure (target)

Build toward this monorepo shape unless the person directs otherwise:

```
afrimart/
├── apps/
│   ├── buyer/          # buyer PWA — responsive, mobile + desktop
│   └── merchant/       # merchant PWA — mobile only, three tabs
├── packages/
│   ├── ui/             # shared design system: tokens, buttons, cards, typography
│   ├── api-client/      # shared typed client for the backend API
│   └── shared/          # shared types: Order, Listing, CanonicalProduct, Shipment...
├── services/
│   └── backend/         # single API: catalogue, orders, routing, payments, notifications
└── docs/                 # this file, the PRD, the brand guide, logo assets
```

One backend, one design-system package, two thin frontend apps. Buyer and merchant never talk to each other directly — both go through the backend. Do not duplicate order/catalogue/routing logic between the two apps.

## Tech stack (confirmed 2026-09-03)

| Part | Choice | Notes |
|---|---|---|
| `apps/buyer`, `apps/merchant` | Next.js (App Router), TypeScript | One framework for both so `packages/ui` stays truly shared; buyer benefits from SSR/ISR on browse/product pages, merchant runs mostly client-rendered |
| `services/backend` | Node.js/TypeScript, Fastify + tRPC | End-to-end typed API into `packages/api-client` without codegen |
| Database | PostgreSQL + Prisma | Prisma's generated types back `packages/shared` |
| Payments | Stripe Connect | Per PRD INT-2 — marketplace collection/splitting/payouts |
| Shipping | EasyPost | Per PRD INT-1 — rates, labels, tracking, address validation across carriers |
| SMS | Twilio, A2P 10DLC registered | Per PRD INT-3 — merchant alerts (MCH-7) and buyer notifications (NTF-2) |
| AI (vision cataloguing, Cook agent, embeddings/search) | Claude (Anthropic API) + Voyage embeddings | ONB-2 vision cataloguing, AGT-2/AGT-6 conversational agent and cooking guidance, CAT-2/CAT-3 knowledge-graph matching |
| Sales tax | Stripe Tax | Per PRD PAY-5/INT-6, integrates directly with Stripe Connect |
| Hosting | Vercel (both PWAs), Railway (backend + Postgres) | Low-ops for MVP stage |
| Package manager / monorepo tool | npm workspaces + Turborepo | Cross-platform, no extra global install required |

## Build sequencing

Unless told otherwise, build in this order, matching the PRD's phase tags and the group's actual rollout plan:

1. **Phase 0 (if requested separately):** a standalone waitlist/landing site — not part of the main monorepo's apps, a simple static site with a buyer/seller fork and email capture. Treat this as its own small project if asked for; don't conflate it with the Phase 1 PWA build.
2. **Phase 1 MVP**, in the order the PRD's functional requirements are grouped: seller onboarding → merchant app → catalogue/canonical resolution → discovery/search → cart/checkout/routing → Cook agent → payments → fulfilment → notifications → operations console.
3. Do not start Phase 2/3-tagged requirements (cold-chain, consolidation, membership, native apps, Canada) without being asked.

## Verifying UI work

Verify by rendering and measuring, not by reading the diff. There is no browser
automation package installed, but Chrome is on the machine and can be driven
headless over the DevTools Protocol (`--remote-debugging-port` plus Node's global
`WebSocket`) to read computed styles and geometry at each breakpoint.

- **Screenshot through CDP (`Page.captureScreenshot`) under the same
  `Emulation.setDeviceMetricsOverride` used for measuring — never Chrome's
  standalone `--screenshot` flag.** That flag has twice produced badly clipped
  images while the DOM measured completely correct: once on the buyer Home pass
  (a contained layout looked overflowing) and once on the merchant inbox (cards
  and the third tab looked cut off, while the DOM reported a 350px card inside a
  390px viewport with zero overflow). Both cost real time chasing a layout bug
  that did not exist. Same emulation for the picture as for the numbers.
- **Measure overflow against the viewport, not the body**: use
  `document.documentElement.scrollWidth - window.innerWidth`. Comparing
  `scrollWidth` to the body's width reports 0 even when the body itself is wider
  than the screen.
- **Drive interactive flows, don't just render them.** Clicking through the
  merchant fulfilment flow surfaced two real bugs that no static render or code
  review would have shown: a stale-closure state update that dropped every
  second rapid tap, and an action disabled only by `pointer-events: none`, which
  stops a mouse but not the keyboard or a script.

## Working conventions

- Confirm the tech stack with the person before scaffolding if it hasn't been specified (framework, hosting, database, payments provider, shipping API provider). The PRD names capability requirements (e.g. "a multi-carrier shipping API"), not vendor lock-in, unless a vendor is explicitly stated.
- Before building any new screen or flow, check `/docs/prototype/` for a matching exported page first — most Phase 1 buyer and merchant screens were already designed and built as HTML prototypes. Only fall back to writing UI from the PRD's prose alone when no matching prototype page exists (currently: the operations console, the seller-verification/quality-assurance flows, Plan an Event, and Community and Social Discovery — see "Design prompts and prototypes" above for the full list, including which small additions piggyback on existing pages instead of needing new ones).
- When a PRD requirement references another (e.g. "reuses SEL-2"), check the referenced requirement before implementing — the PRD is written to be internally consistent and cross-referenced.
- Flag, rather than silently resolve, any place where the PRD's Phase 1 scope and its non-goals section seem to conflict with a specific request.

## Docs in this repo

- `/docs/AfriMart_PRD.md` — full product requirements
- `/docs/AfriMart_Brand_Guide.pdf` — logo, palette, type, voice
- `/docs/brand/` — logo files (avatar, reversed mark, cover)
- `/docs/prototype/` — the standalone Claude Design HTML pages (buyer app fully responsive; merchant deliberately mobile-only) — the UI spec (see "Design prompts and prototypes" above)
- `/docs/AfriMart_Claude_Design_Prompts.md` — the original prompts used to generate the prototype, useful for intent/rationale behind a screen
- `/docs/AfriMart_Pitch.docx` — narrative context on why the product is built this way (background reading, not spec)

If you need the PRD or pitch in plain text for easier searching, convert with `pandoc -t markdown file.docx`, but treat the `.docx` as canonical if the two ever diverge after edits.
