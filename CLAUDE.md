# CLAUDE.md — AfriMart

This file orients any Claude Code session working on this repository. Read this first, then `/docs/AfriMart_PRD.md` for the full specification and `/docs/AfriMart_Claude_Design_Prompts.md` for the UI spec, before writing code.

## What this project is

AfriMart is a shipping-first, AI-powered marketplace for African groceries in the United States. African stores, home-based sellers, and aspiring food entrepreneurs list products; buyers anywhere in the US order and receive them by nationwide shipping. Full specification: `/docs/AfriMart_PRD.md`.

Read `/docs/AfriMart_Brand_Guide.pdf` before writing any UI, if it has been added to the repo — see "Docs in this repo" below; it has not been supplied yet, so until it lands, cross-check any brand-token question directly with the person rather than guessing.

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

**⚠ Unresolved conflict with the prototype, flagged not silently fixed:** the built Design System prototype (`/docs/prototype/AfriMart Design System.html`) does not use this table. Its actual single-action accent is **Terracotta `#C05621`** ("one terracotta action per screen" — every primary CTA across all six functional prototype pages uses it); Amber `#E8A44D` appears only for star ratings, and a separate Antique Gold `#B0894F` is reserved for ceremony (seals, dividers, Taste of Home). Ink is `#23201A` (warm charcoal) rather than `#222222`. Since no Brand Guide PDF has been supplied yet to arbitrate, this file cannot say which is authoritative — resolve with the person before `packages/ui` locks in an accent color, rather than guessing.

Typography direction: a classic high-contrast serif for display/headlines, a clean humanist sans for UI and body text. Aesthetic: premium and classic — "heritage grocer," not discount e-commerce or generic startup. Voice: warm, plain-spoken, dignified, never salesy, no exclamation marks.

Logo files are in `/docs/brand/` (avatar, reversed mark, cover lockup). Use the avatar for small square placements (favicon, app icon); the full lockup where there's room to introduce the brand.

## Design prompts and prototypes

Both apps were designed before this build started: wireframed in Relume, then built as clickable HTML prototypes in Claude Design, using the prompt packs included in this repo. Treat the resulting prototypes as the UI spec — not the prompts alone, the actual generated pages.

**The prototype project contains these pages** (Claude Design project "project," 11 pages):

| Prototype page | Covers |
|---|---|
| `AfriMart Design System.html` | Master tokens, type scale, components — read this first, it's the shared system both apps draw from |
| `AfriMart Buyer App.html` | Buyer app shell / entry point |
| `AfriMart Buyer - Browse and Product.html` | Homepage, shop/category browse, search results, product detail |
| `AfriMart Buyer - Cart and Checkout.html` | Cart, checkout, order confirmation |
| `AfriMart Buyer - Cook.html` | The Cook AI agent (recipe-to-cart) conversational surface |
| `AfriMart Buyer - Boxes Tracking and Account.html` | Taste of Home boxes, order tracking, account/order history |
| `AfriMart Merchant.html` | Merchant app shell — Camera / Orders / Messages, order fulfilment flow |
| `AfriMart Merchant - Onboarding.html` | Merchant onboarding: shelf-filming / website import, catalogue review |
| `AfriMart Logo Downloads.html`, `AfriMart Logo and Social Kit.html`, `AfriMart Logo Directions.html` | Brand assets and usage — reference alongside the Brand Guide, not functional UI |

Folders in the same project: `Design system files/` and `assets/` — export these alongside the pages above; they likely hold the actual token definitions and image/icon assets the pages reference.

**Status: 8 of 11 pages are in the repo** under `/docs/prototype/` — the 6 functional buyer/merchant screens, the Design System, and the Merchant Onboarding flow. Missing: `AfriMart Logo Directions.html`, and the `Design system files/` and `assets/` export folders (token/asset source files referenced by the pages). The two logo/brand pages present (`Logo Downloads.html`, `Logo and Social Kit.html`) are reference only, not functional UI. Ask the person for the missing three before treating the design-system extraction below as final on assets.

**These are Claude Artifact bundle exports, not plain HTML.** Each file is a self-extracting bundle (a `<script type="__bundler/template">` tag holding the real page as a JSON-escaped string, plus a manifest of base64 fonts/images) — opening the raw file in a text editor shows loader boilerplate, not the design. It renders correctly in a browser. For reading/reuse as a spec, use the already-extracted plain HTML in `/docs/prototype/extracted/` (one file per functional page, same filenames) — that's the real markup and CSS, unpacked once via a small Node script. If a prototype page is re-exported later, re-run the same extraction (read the `__bundler/template` script tag's JSON string and write it out) before using it as a build reference.

Rules for using them:

- **Read the actual HTML/CSS, not just a screenshot.** Use the extracted versions in `/docs/prototype/extracted/` — they show real markup, spacing values, and component structure, closer to a spec than a picture of it. Match layout, hierarchy, and component choices; adapt markup to the project's actual framework rather than copying HTML verbatim.
- **Start from `AfriMart Design System.html`.** It's the shared source for tokens, type, and components — build `packages/ui` from it before building individual screens, so buyer and merchant stay visually consistent by construction.
- **Match structure and hierarchy, not pixels.** Translate layout and emphasis faithfully (e.g. "one dominant Accept button," "large tap targets," a right-rail order summary); don't feel obligated to pixel-match spacing that a proper component library will naturally handle differently.
- **Buyer app is responsive; merchant app is mobile-only.** The prototypes reflect this deliberately. Do not design a desktop merchant experience unless explicitly asked (see Product principles: merchant simplicity).
- **The two apps share one design system, applied differently.** Same tokens, type, and component DNA; the merchant app dials density down and tap targets up. Build a shared component once in `packages/ui`, not twice.
- **If a build decision and the prototype conflict** (e.g. a pattern is awkward in the chosen framework, or accessibility requires a change), prefer fidelity to the prototype's intent over its literal layout, and flag the deviation rather than silently drifting from it.
- **No prototype page exists yet for the operations console (6.11) or the seller-verification/quality-assurance flows (6.13).** Build those from the PRD's prose and the established design system until a prototype is provided.

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

## Build sequencing

Unless told otherwise, build in this order, matching the PRD's phase tags and the group's actual rollout plan:

1. **Phase 0 (if requested separately):** a standalone waitlist/landing site — not part of the main monorepo's apps, a simple static site with a buyer/seller fork and email capture. Treat this as its own small project if asked for; don't conflate it with the Phase 1 PWA build.
2. **Phase 1 MVP**, in the order the PRD's functional requirements are grouped: seller onboarding → merchant app → catalogue/canonical resolution → discovery/search → cart/checkout/routing → Cook agent → payments → fulfilment → notifications → operations console.
3. Do not start Phase 2/3-tagged requirements (cold-chain, consolidation, membership, native apps, Canada) without being asked.

## Working conventions

- Confirm the tech stack with the person before scaffolding if it hasn't been specified (framework, hosting, database, payments provider, shipping API provider). The PRD names capability requirements (e.g. "a multi-carrier shipping API"), not vendor lock-in, unless a vendor is explicitly stated.
- Before building any new screen or flow, check `/docs/prototype/` for a matching exported page first — most Phase 1 buyer and merchant screens were already designed and built as HTML prototypes. Only fall back to writing UI from the PRD's prose alone when no matching prototype page exists (currently: the operations console and the seller-verification/quality-assurance flows).
- When a PRD requirement references another (e.g. "reuses SEL-2"), check the referenced requirement before implementing — the PRD is written to be internally consistent and cross-referenced.
- Flag, rather than silently resolve, any place where the PRD's Phase 1 scope and its non-goals section seem to conflict with a specific request.

## Docs in this repo

- `/docs/AfriMart_PRD.md` — full product requirements
- `/docs/AfriMart_Claude_Design_Prompts.md` — the original prompts used to generate the prototype, useful for intent/rationale behind a screen
- `/docs/AfriMart_Claude_Code_Prompts.md` — the build-prompt sequence this repo is following
- `/docs/AfriMart_Pitch.docx` — narrative context on why the product is built this way (background reading, not spec)
- `/docs/prototype/` — 8 of the 11 exported Claude Design HTML pages (bundle format — see "Design prompts and prototypes" above), plus `/docs/prototype/extracted/` holding the same pages unpacked to plain HTML/CSS for actual reading and reuse

**Not yet in the repo** (ask the person for these before treating brand/asset decisions as final):
- `/docs/AfriMart_Brand_Guide.pdf` — logo, palette, type, voice ground truth
- `/docs/brand/` — logo files (avatar, reversed mark, cover)
- `/docs/AfriMart_Relume_Prompts.md` — sitemap and wireframe structure behind the prototypes
- `/docs/prototype/AfriMart Logo Directions.html`, and the prototype project's `Design system files/` and `assets/` export folders

If you need the pitch doc in plain text for easier searching, convert with `pandoc -t markdown file.docx`.
