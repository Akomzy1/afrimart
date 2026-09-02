# AfriMart — Claude Design Prompt Pack (Premium Classic Prototypes)

How to use: Work in ONE Claude Design project. Paste **Prompt 1** first to establish the design system. Then build the buyer prototype with **Prompts 2–6** in order, attaching the matching Relume wireframes to each. Then build the merchant prototype with **Prompts 7–9**. Finish with **Prompt 10** as a consistency pass across both. This pack supersedes the brand brief (Prompt 13) in the Relume pack.

---

## Prompt 1 — Design system foundation (paste first, before any screens)

Establish the design system for AfriMart, a premium marketplace for African groceries in the US. Aesthetic: premium with classic elegance — think heritage grocer and fine provisions house, not discount e-commerce. Editorial, confident, unhurried.

Palette: deep market-green #1F3D2B as the primary; warm harvest-amber #E8A44D as the accent, used sparingly for emphasis and key actions; warm ivory/cream backgrounds (not stark white); charcoal near-black for text; a restrained soft gold hairline accent for moments of ceremony (badges, dividers, the Taste of Home boxes). Generous whitespace throughout.

Typography: a classic high-contrast serif for display headlines and product names — elegant, editorial, timeless; a clean humanist sans-serif for UI labels, body, and controls. Clear typographic hierarchy; letterspaced small-caps for eyebrow labels and section markers.

Components: refined and architectural rather than bubbly — subtle corner radii (crisp, not pill-shaped), hairline borders, soft shadow only where elevation matters. Buttons: solid deep-green primary with serene confidence; amber reserved for the single most important action per screen. Product imagery treated like still-life photography: foods on warm neutral backgrounds, generous padding, never cluttered. Badges (Verified Seller, Freshness Promise) as understated seals, not loud stickers. Iconography: thin-line, consistent weight.

Voice in UI copy: warm, plain-spoken, dignified — "The market from home, delivered." Never salesy, never shouting, no exclamation marks.

This system serves two apps: a buyer shopping PWA and a merchant fulfilment PWA. Define it once here; both will draw from it.

---

## Prompt 2 — Buyer prototype: shell, homepage, and navigation

Using the design system, build the buyer app as a mobile-first PWA prototype. Start with the app shell and homepage from the attached wireframe.

Homepage: an editorial hero — full-bleed still-life of African foods with the serif headline "The market from home, delivered anywhere in America" and a single primary CTA. Search bar treated as a centerpiece with rotating multilingual placeholder (egusi, gari, ata rodo, berbere, suya spice). Cuisine collections as elegant tiles with serif labels (Nigerian, Ghanaian, Ethiopian, Somali, Kenyan, Cameroonian). A restrained three-step "How it works" strip. Featured staples in a clean product grid. A quiet, gold-accented promo band for Taste of Home boxes. A dignified seller invitation band: "Own a store or cook from home? Sell on AfriMart." Bottom navigation: Home, Shop, Cook (AI agent), Orders, Account — thin-line icons, serif-free labels.

Keep density low; let imagery and whitespace carry the premium feel.

---

## Prompt 3 — Buyer prototype: shop, search, and product detail

Build the browse and product screens from the attached wireframes, in the same system.

Shop/category: filterable grid; product cards with still-life image, serif product name, the alternate name beneath in small italics ("Egusi — melon seeds"), price in tabular figures, seller name with a subtle Verified seal, ships-in estimate. Filters in a slide-over panel, elegant checkboxes, cuisine and category groups.

Search results: the resolved-name pattern rendered gracefully — "Showing garri, also known as gari, cassava flakes" as an editorial line under the search bar. Zero-results state offers the closest match and a quiet "Ask our AI to find it" link.

Product detail: large gallery with generous padding; serif name with language chips beneath (Yoruba, Igbo, Twi names as small elegant tags); price and pack size; seller block with seal, metro, rating in understated stars; "Also available from" cross-store list as a refined comparison; shipping estimator (zip → arrival date and free-shipping progress) presented as a calm utility, not a widget; for made-to-order items, a lead-time note set like a considered footnote; a "How it's used" editorial section linking to the Cook agent; reviews.

---

## Prompt 4 — Buyer prototype: cart and checkout

Build cart and checkout from the attached wireframes. This is where trust is won; keep it serene and transparent.

Cart: line items grouped by shipment under quiet header rules — "Ships from Houston · arrives Thursday." Free-shipping progress as a thin elegant bar with plain copy ("$14 away from free shipping"). Multi-parcel note as a composed sentence, never an alert: "Your order arrives in two parcels — Thursday and Friday. One order, one total."

Checkout: short, single-flow; address with validation; per-parcel arrival dates restated; payment (card and wallets); order summary with a single total and one blended shipping line, never two fees. The pay button is the screen's one amber moment. Confirmation: a gracious full-screen moment — serif "Your order is on its way," parcel timeline, tracking expectations, gentle account nudge.

---

## Prompt 5 — Buyer prototype: Cook (recipe-to-cart agent)

Build the AI agent surface from the attached wireframe as "Cook" — an elegant conversational room, not a chatbot widget.

Opening state: serif prompt "What are you cooking, and for how many?" with example chips (Jollof for 8 · Egusi soup for 6 · Doro wat for 4). Agent responses render the proposed basket as a refined editable list: item, quantity, price, substitution notes set in italics with reasons, arrival feasibility, running total with free-shipping status. One primary action: "Add all to cart." A quiet reassurance line that ordinary shopping is always available. The agent's voice matches the brand: knowledgeable, warm, unhurried — like a trusted market auntie with perfect logistics.

---

## Prompt 6 — Buyer prototype: Taste of Home, tracking, and account

Build the remaining buyer screens from the attached wireframes.

Taste of Home boxes: the most ceremonial surface — gold hairline accents, serif editorial layout; each regional edition (Nigerian, Ghanaian, Ethiopian, Kenyan) as a considered card with contents preview and price; gifting flow given prominence ("Send a taste of home to your student") with a message-card step.

Order tracking: calm timeline per parcel under one order; status in plain language; delivery-issue link set discreetly.

Account: order history with one-tap reorder as the hero pattern (reorder is the retention engine — make it effortless and visually rewarding); addresses; payment methods; help.

---

## Prompt 7 — Merchant prototype: shell and order fulfilment

Now build the second app in this same project, using the same design system: AfriMart Merchant, a chat-simple PWA for store owners and home sellers. Premium in materials, utilitarian in structure. Same palette, same type family — but dial the application: larger type, much larger tap targets, high contrast for bright daylight, minimal words, one action per moment. Exactly three tabs: Camera, Orders, Messages. It must remain unmistakably the same brand as the buyer app while feeling as simple as a chat app. Usability outranks refinement on every screen; nothing delicate.

Orders tab (from attached wireframes): new-order cards with the order number, item count, and value in large type; one dominant Accept button (the amber moment). Order detail: photo packing list using catalogue images as large checkable tiles; then a single progressing action — Print label → Mark packed → Pickup scheduled — as one big button that advances state. Completed state gives a moment of quiet dignity: "Order packed. Well done."

---

## Prompt 8 — Merchant prototype: camera, stock, and onboarding

Camera tab: the heart of the app. Two large actions: "New stock arrived" (snap the delivery, AI updates quantities) and "Update availability" (hold-to-talk voice note — "ogbono finished till Friday" — with a simple confirmation of what was understood). Photo-first, instruction-light.

Onboarding flow (from attached wireframes): welcome with phone sign-in; choose your path — "Film your shelves" or "Connect your website" as two large cards; guided shelf filming with calm on-screen coaching ("Move closer to the shelf tag"); catalogue review as large product tiles with tap-to-correct name and price; a dignified going-live moment: serif "Your store is open to all of America."

---

## Prompt 9 — Merchant prototype: catalogue, earnings, and messages

Catalogue: large-tile product list, tap to edit price or availability with oversized controls.

Earnings: the payout summary in confident tabular serif figures — total this week, next payout date, simple history. Money presented with clarity and respect; no charts for the sake of charts.

Messages: support and order threads in a familiar chat pattern, same components as the buyer agent surface but stripped to essentials.

---

## Prompt 10 — Consistency pass (run after both prototypes exist)

Review both prototypes side by side as one brand. Enforce: identical palette values, identical type families and weights, identical button/card/badge components, identical iconography weight, identical voice. Confirm the deliberate divergences and only those: merchant has larger targets, larger type, lower density, three-tab navigation, and one-action-per-screen structure; buyer has richer layouts, editorial imagery, and shopping navigation. The test: at a glance they are unmistakably the same premium brand; in use they are obviously two different tools. Flag and fix any drift in radii, shadows, spacing scale, or shade values between the two.
