# AfriMart — Product Requirements Document

*AI-Powered Marketplace for African Groceries — United States*

**Version 0.1 · Draft for Review**
Prepared by AkomzyAi Consulting Ltd · July 2026

## 1. Overview

This document specifies the product to be built: AfriMart, a shipping-first, AI-powered online marketplace through which African grocery stores in the United States list their products for African consumers nationwide. It exists to solve a concrete problem — that African food is inaccessible to the large and dispersed diaspora living far from the handful of metros where physical African stores cluster — by turning existing stores into a national fulfilment network and giving buyers a culturally fluent way to find and order the food of home. AfriMart's supply is a spectrum rather than a single seller type — established stores, home-based sellers, and aspiring food entrepreneurs given a route to start — which both widens the catalogue into differentiated products and positions AfriMart as infrastructure for African food entrepreneurship in the United States.

The product has three defining characteristics. It is shipping-first, not local-delivery, so it reaches the remote buyer who is the core underserved customer. It is AI-native in three specific places: onboarding cash-based stores by turning their shelves or websites into a digital catalogue, resolving the many names and spellings the same product carries across languages, and orchestrating fulfilment across independent stores. And it is asset-light: stores fulfil from their own shelves, carriers move the goods, and the platform holds no inventory and operates no warehouses.

This PRD is scoped around a Phase 1 Minimum Viable Product — an ambient-only, single-supply-metro launch shipping nationwide — with later-phase capabilities (cold-chain, consolidation, subscriptions, membership, advertising, and geographic expansion) specified at lower resolution and mapped to the release plan in Section 10. Requirements are tagged by the phase in which they are expected to ship.

## 2. Objectives and Success Metrics

The Phase 1 objective is to prove that dispersed diaspora buyers will order African groceries online and reorder, and that the shipping unit economics can close, using the smallest operationally viable build. The two existential unknowns the MVP must resolve are customer acquisition cost and — once perishables enter — cold-chain reliability.

**North Star metric:** reorder rate — the share of buyers who place a second order within 60 days — because repeat purchasing is the truest signal that the product solves the problem and that unit economics can compound.

**Supporting metrics:** first 1,000 nationwide orders (Phase 1 milestone); repeat-purchase rate above 40% (Phase 2 gate); average basket size relative to the free-shipping threshold; share of orders fulfilled from a single store; catalogue accuracy (buyer-flagged item error rate); merchant order-acceptance rate and fulfilment time; blended CAC as a fraction of 12-month contribution margin; and, once cold-chain launches, the perishable damage/spoilage rate.

## 3. Scope: Goals and Non-Goals

**In scope for Phase 1**

Seller onboarding via shelf-filming vision cataloguing and via structured product-feed import; a chat-simple merchant application with an SMS notification rail; a master product catalogue with canonical-name resolution; buyer discovery through multilingual search, category browse, and one-tap reorder; cart, checkout, and a single-store-preferring routing engine; a conversational agent whose headline capability is recipe-to-cart; marketplace payments with take-rate splitting; ambient nationwide shipping via a multi-carrier shipping API; order tracking and buyer notifications; home-based sellers of shelf-stable goods under a seller-verification and food-safety layer; and an internal operations console for catalogue review, onboarding, and order monitoring.

**Explicit non-goals (deliberately excluded from Phase 1)**

Local same-day delivery is out of scope — it competes with Instacart in the one segment where the problem is smallest and abandons the remote-buyer positioning. Cold-chain and perishable/frozen fulfilment are deferred to Phase 2. Multi-store order consolidation is deferred to Phase 2. Canada and all non-US geographies are deferred to Phase 2. Subscription boxes and the membership tier are later-phase. Fresh and prepared home-kitchen food, and the aspiring-entrepreneur on-ramp (starter flow, demand-testing, and AI seller guidance), are deferred to Phase 2. Owning inventory, operating warehouses, or running a delivery fleet are out of scope entirely — the model is and remains asset-light. Negotiated direct carrier contracts are a Phase 3 optimisation.

**Phase key:** Phase 1 = MVP launch (ambient, one supply metro, nationwide). Phase 2 = cold-chain, second supply metro, consolidation, replenishment, curated boxes, Canada. Phase 3 = membership tier, brand advertising, further expansion, negotiated carrier contracts.

## 4. User Personas

**Buyers**

**The distance-constrained buyer** lives far from any African store — a smaller city, a university town, a low-store-density state — and today drives hours, stockpiles, or relies on travelling relatives. Shipping-first reach is the entire value proposition for this persona, who is the core target.

**The convenience-driven buyer** lives near a store but prefers to order online for time and ease. Less acute need, but higher digital comfort and a source of early density in supply metros.

**The occasion cook and gifter** shops for a specific event or sends food to a student or relative. Primary user of recipe-to-cart and curated boxes.

**Sellers**

**The cash-based store owner** runs a family business with no POS, no catalogue, and low digital comfort. Onboarded by filming shelves; operates entirely through the chat-simple merchant app. The majority of supply.

**The digitally mature store** already has a website or an online storefront. Onboarded by direct catalogue import, and a candidate for ongoing two-way sync. A minority, but low-friction to acquire.

**The home-based seller** operates informally from their kitchen or home, selling today through social media, community networks, and word of mouth. Their offering is often differentiated and made-to-order — ground blends, packaged snacks, dried and smoked fish, prepared and semi-prepared foods — and expands the catalogue into products stores do not carry. The camera-first merchant app suits them as well as it suits a store; their supply is more intermittent and more perishable-heavy, and they require light verification before selling to strangers.

**The aspiring food entrepreneur** wants to start a food business but is blocked by the usual barrier: needing customers before inventory, and a channel before customers. AfriMart offers a route to begin with no storefront and no upfront inventory, against an existing customer base — start with a single product, test demand before committing to a batch, and grow into a home seller and then a store. This group needs enablement, guidance and demand-testing, before and alongside the ability to list.

**Internal**

**The catalogue/operations reviewer** approves AI-generated catalogues, resolves low-confidence items, manages onboarding and hub assignment, and monitors fulfilment. Works in the operations console.

## 5. Key User Journeys

**Seller onboarding**

A field representative or remote session installs the merchant app on the owner's phone in seconds. The onboarding flow asks whether the store has a website. If not, the owner films the aisles and the vision pipeline builds a draft catalogue; if so, the platform imports the product feed directly. The owner reviews and corrects the draft in the app, low-confidence items are confirmed, the starter kit (packaging and label printer) is issued, and the store goes live assigned to a supply hub.

**Buyer first order — direct**

A buyer searches for a product by whatever name or spelling they use, or browses by cuisine. They add items to the cart; the routing engine works invisibly to keep the basket fillable from one store. At checkout the system rate-shops carriers, shows a single total with free shipping above the threshold, states the expected arrival, and takes payment. The order is routed to the store, which accepts, packs from a photo packing list, prints the label, and hands off to carrier pickup. The buyer receives tracking notifications through to delivery.

**Buyer order — recipe-to-cart**

A buyer opens the conversational agent and names a dish and a headcount. The agent assembles a scaled basket, checks availability across stores, proposes substitutions for anything unavailable, and optimises the basket for cost and arrival date — then hands the buyer a ready cart that flows into the same checkout.

**Multi-store order fulfilment**

When no single store can complete a basket, the routing engine splits it by source; each store packs and ships its own portion. The buyer sees one order and one total, with the multi-parcel arrival disclosed at checkout and the extra shipping cost absorbed under the free-shipping threshold. Each parcel is tracked individually under one order view.

## 6. Functional Requirements

### 6.1 Seller Onboarding

Onboarding adapts to each store's digital maturity across three rails, with shelf-filming as the default for the cash-based majority.

| **ID**    | **Requirement**                                                                                                                                                           | **Phase** |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **ONB-1** | Adaptive onboarding flow that determines the store's digital maturity and routes to the appropriate rail (filming, structured import, or sync).                           | 1         |
| **ONB-2** | Vision cataloguing: capture shelf footage via the merchant app camera; extract product name, brand, pack size, and shelf-tag price; assemble a draft catalogue.           | 1         |
| **ONB-3** | Guided capture UX that detects unusable frames (blur, distance, illegible tags) and prompts the owner to re-shoot.                                                        | 1         |
| **ONB-4** | Website import (detection-first): identify the commerce platform and ingest its structured product feed; parse standard product markup where present.                     | 1         |
| **ONB-5** | AI extraction fallback for unstructured sites, price lists, and social shops: crawl product pages or screenshots and return normalized records via a fixed output schema. | 2         |
| **ONB-6** | Human-in-the-loop review: the owner reviews and corrects the draft catalogue in the merchant app before it publishes.                                                     | 1         |
| **ONB-7** | Two-way sync connector for stores on mainstream platforms: mirror price and stock changes automatically via API and webhooks.                                             | 2         |
| **ONB-8** | Onboarding kit tracking: record issuance of packaging and label printer, and assignment of the store to a supply hub.                                                     | 1         |

### 6.2 Merchant Application

A progressive web app deliberately shaped like the chat apps these owners already use, requiring no app store and no training, running on the platform's own rails.

| **ID**    | **Requirement**                                                                                                                                             | **Phase** |
|-----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **MCH-1** | Installable PWA via add-to-home-screen; no app-store dependency; usable on low-end Android phones.                                                          | 1         |
| **MCH-2** | Three-surface interface: camera, order inbox, message box — no dashboard to learn.                                                                          | 1         |
| **MCH-3** | Order inbox with one-tap accept, photo packing list built from the store's own catalogue images, and reject-with-reason.                                    | 1         |
| **MCH-4** | Shipping-label rendering to a standard printer or a 4x6 label printer as PDF.                                                                               | 1         |
| **MCH-5** | Automatic carrier-pickup scheduling on order acceptance.                                                                                                    | 1         |
| **MCH-6** | Conversational stock updates: a delivery photo updates quantities; a voice note (“X finished till Friday”) pauses or adjusts a listing via voice-to-action. | 1         |
| **MCH-7** | Push notifications for new orders and time-sensitive events, backed by an SMS fallback so no order is missed.                                               | 1         |
| **MCH-8** | Earnings and payout visibility for the store.                                                                                                               | 1         |
| **MCH-9** | Merchant performance view (orders, acceptance rate, ratings).                                                                                               | 2         |

### 6.3 Catalogue and Canonical Resolution

The cultural knowledge graph and entity resolution are a core moat: they make a fragmented, multilingual supply base searchable as one catalogue.

| **ID**    | **Requirement**                                                                                                                                                | **Phase** |
|-----------|----------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **CAT-1** | Master canonical product registry: each product an entity with canonical name, category, cuisine, pack size, and images.                                       | 1         |
| **CAT-2** | Cultural knowledge graph mapping alternate names and spellings across Yoruba, Igbo, Twi, Amharic, Swahili, French, and phonetic English to canonical products. | 1         |
| **CAT-3** | Entity resolution: match a store's raw product string to a canonical SKU and deduplicate the same product across stores.                                       | 1         |
| **CAT-4** | Store listing model: canonical SKU plus store-specific price, stock status, and fulfilment attributes.                                                         | 1         |
| **CAT-5** | Temperature and handling classification (ambient / refrigerated / frozen) and shipping weight per product, to drive routing and feasibility.                   | 1         |
| **CAT-6** | Confidence thresholds that route uncertain vision- or extraction-derived items to manual confirmation before publishing.                                       | 1         |

### 6.4 Discovery and Search

Most buyers know exactly what they want; the default experience is fast, familiar, and never requires talking to an assistant.

| **ID**     | **Requirement**                                                                                                                                     | **Phase** |
|------------|-----------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **SRCH-1** | Multilingual, multi-spelling search resolving any name to the canonical product via the knowledge graph.                                            | 1         |
| **SRCH-2** | Browse by category and by cuisine (e.g. Nigerian, Ghanaian, Ethiopian, Somali).                                                                     | 1         |
| **SRCH-3** | Product detail page showing cross-store availability and price.                                                                                     | 1         |
| **SRCH-4** | One-tap reorder from order history.                                                                                                                 | 1         |
| **SRCH-5** | Shipping-availability awareness in results: whether an item reaches the buyer's zip and, for perishables, whether it can arrive in the safe window. | 1         |
| **SRCH-6** | Personalized replenishment suggestions based on prior orders.                                                                                       | 2         |

### 6.5 Cart, Checkout, and Routing Engine

The routing engine is the operational heart of the marketplace: it concentrates baskets on a single store, separates shipments by temperature, and keeps price simple for the buyer.

| **ID**     | **Requirement**                                                                                                                                                                                                                                                  | **Phase** |
|------------|------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **CART-1** | Cart supporting items sourced from multiple stores.                                                                                                                                                                                                              | 1         |
| **CART-2** | Single-store-preferring routing: complete the basket from one store wherever possible, accepting a modest price difference to avoid a split; spread across stores only when no single store can complete it; optimise for landed shipping cost and arrival date. | 1         |
| **CART-3** | Mandatory temperature split: ambient and perishable items always ship as separate shipments.                                                                                                                                                                     | 1         |
| **CART-4** | Perishable feasibility enforcement at checkout via live carrier transit query; block any perishable that cannot arrive in the safe window.                                                                                                                       | 2         |
| **CART-5** | Free-shipping threshold logic: absorb multi-shipment cost above the threshold; below it, present a single blended shipping charge, never two separate fees.                                                                                                      | 1         |
| **CART-6** | Multi-parcel arrival disclosure at checkout: number of parcels and estimated delivery dates.                                                                                                                                                                     | 1         |
| **CART-7** | Anchor-store consolidation: option for the routing engine to combine multi-store items intra-metro into one shipment where volume justifies it.                                                                                                                  | 2         |
| **CART-8** | Real-time rate shopping across carriers via the shipping API at checkout.                                                                                                                                                                                        | 1         |

### 6.6 Conversational AI Agent

An optional layer for jobs a product grid cannot do — never a gate in front of ordinary ordering.

| **ID**    | **Requirement**                                                                                                                                                                                                                                                           | **Phase** |
|-----------|---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **AGT-1** | Conversational shopping agent as an optional surface, additive to and never blocking standard search-and-cart.                                                                                                                                                            | 1         |
| **AGT-2** | Recipe-to-cart: parse dish and headcount, assemble a scaled basket, check availability across stores, and propose substitutions.                                                                                                                                          | 1         |
| **AGT-3** | Substitution suggestions when an item is unavailable or infeasible to ship in time.                                                                                                                                                                                       | 1         |
| **AGT-4** | Auto-replenishment agent: learn a household's cadence and proactively suggest reorders before staples run out.                                                                                                                                                            | 2         |
| **AGT-5** | Agent obeys the same routing, feasibility, and threshold logic as standard checkout.                                                                                                                                                                                      | 1         |
| **AGT-6** | Cooking guidance: on request, the agent provides step-by-step instructions for the named dish, scaled to the buyer's headcount and grounded in the items they ordered, drawing on a curated, authenticity-reviewed recipe library that the AI adapts rather than invents. | 1         |
| **AGT-7** | Cook-along and delivery follow-up: when a recipe order is delivered, the agent offers to guide the cooking session (“your ingredients have arrived — ready to cook?”), closing the loop from recipe to basket to delivery to a successful meal.                           | 2         |

### 6.7 Payments

Marketplace payments must collect from the buyer and remit to independent stores net of the platform's take.

| **ID**    | **Requirement**                                                                                                | **Phase** |
|-----------|----------------------------------------------------------------------------------------------------------------|-----------|
| **PAY-1** | Buyer checkout supporting cards and digital wallets.                                                           | 1         |
| **PAY-2** | Marketplace payment splitting: collect from buyer, remit to the fulfilling store(s) net of take rate and fees. | 1         |
| **PAY-3** | Configurable take rate (12–15%) plus per-order fulfilment/packaging fee.                                       | 1         |
| **PAY-4** | Refunds and partial refunds for damaged or missing items.                                                      | 1         |
| **PAY-5** | Sales-tax calculation by jurisdiction.                                                                         | 1         |
| **PAY-6** | Store payout scheduling and statements.                                                                        | 1         |
| **PAY-7** | Recurring billing for subscription boxes and membership.                                                       | 3         |

### 6.8 Fulfilment and Logistics

A single multi-carrier shipping API is the entire logistics layer; no carrier contracts or logistics partner are required to launch.

| **ID**    | **Requirement**                                                                                                                                                  | **Phase** |
|-----------|------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **FUL-1** | Multi-carrier shipping API integration providing rates, labels, address validation, tracking, and pickup across USPS, UPS, FedEx, and regional carriers.         | 1         |
| **FUL-2** | Least-cost carrier selection that meets the promised arrival-window constraint.                                                                                  | 1         |
| **FUL-3** | Ambient nationwide shipping from hub-metro stores.                                                                                                               | 1         |
| **FUL-4** | Address validation to reduce failed deliveries.                                                                                                                  | 1         |
| **FUL-5** | Cold-chain shipping: platform-supplied insulated packaging, refrigerant selection (gel packs for refrigerated, dry ice for frozen), restricted to two-day zones. | 2         |
| **FUL-6** | Dry-ice hazmat handling: automated compliant labelling and enforcement of per-package limits at label generation.                                                | 2         |
| **FUL-7** | Ship-day discipline for perishables: prevent shipments that would sit in transit over a weekend without temperature control.                                     | 2         |
| **FUL-8** | Bring-your-own-carrier: plug negotiated carrier accounts into the same shipping API at volume.                                                                   | 3         |

### 6.9 Notifications and Order Tracking

Reliable order-state communication protects trust in a category where trust is the recurring failure point.

| **ID**    | **Requirement**                                                                                          | **Phase** |
|-----------|----------------------------------------------------------------------------------------------------------|-----------|
| **NTF-1** | Order-state pipeline (placed, accepted, packed, shipped, delivered) driven by carrier tracking webhooks. | 1         |
| **NTF-2** | Buyer notifications by email and SMS for order confirmation, shipment, and tracking.                     | 1         |
| **NTF-3** | Multi-parcel tracking: each parcel individually trackable under one unified order view.                  | 1         |
| **NTF-4** | Merchant transactional SMS via registered A2P 10DLC campaign.                                            | 1         |
| **NTF-5** | Delivery-issue flagging: buyer reports damage or a missing item, triggering the refund and support path. | 1         |

### 6.10 Subscriptions, Boxes, and Membership

Later-phase revenue and retention mechanics, specified at low resolution here.

| **ID**    | **Requirement**                                                                   | **Phase** |
|-----------|-----------------------------------------------------------------------------------|-----------|
| **SUB-1** | “Taste of Home” curated regional boxes: catalogue, one-off purchase, and gifting. | 2         |
| **SUB-2** | Recurring box subscriptions with management and pause/cancel.                     | 2         |
| **SUB-3** | Free-shipping membership tier.                                                    | 3         |
| **SUB-4** | Brand advertising and sponsored placement for African food brands.                | 3         |

### 6.11 Operations Console

The internal surface through which the team maintains catalogue quality, onboarding, fulfilment, and reconciliation.

| **ID**    | **Requirement**                                                                         | **Phase** |
|-----------|-----------------------------------------------------------------------------------------|-----------|
| **ADM-1** | Catalogue review queue: approve AI-catalogued items and resolve low-confidence entries. | 1         |
| **ADM-2** | Store onboarding management: status, kit issuance, and hub assignment.                  | 1         |
| **ADM-3** | Order and fulfilment monitoring with the ability to intervene on stuck orders.          | 1         |
| **ADM-4** | Knowledge-graph management: add canonical products and name mappings.                   | 1         |
| **ADM-5** | Financial reconciliation across payouts, take rate, and tax.                            | 1         |
| **ADM-6** | Store performance and ranking management.                                               | 2         |

### 6.12 Seller Types, Verification, and the Entrepreneur On-Ramp

AfriMart's supply spans established stores, home-based sellers, and aspiring entrepreneurs — a ladder from someone starting out to a full store. Beyond the store onboarding in 6.1, this tier requires a made-to-order listing model, a verification and food-safety layer, and an enablement path for those beginning a food business.

| **ID**    | **Requirement**                                                                                                                                                                                              | **Phase** |
|-----------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **SEL-1** | Made-to-order and batch listing model: availability states (in stock, made-to-order), lead time, and per-batch quantity caps, so a buyer cannot order beyond what a seller can fulfil.                       | 1         |
| **SEL-2** | Seller verification and food-safety attestation, appropriate to the seller type, required before a non-store seller can list to the public.                                                                  | 1         |
| **SEL-3** | Home-seller onboarding of shelf-stable goods via the camera-first merchant app, with social-storefront (e.g. Instagram) import through the AI-extraction fallback where applicable.                          | 1         |
| **SEL-4** | Quality gating: new and unproven sellers begin with limited visibility and scale, earning reach through fulfilment performance and ratings, to protect catalogue trust.                                      | 1         |
| **SEL-5** | Fresh and prepared home-kitchen food, gated on cold-chain and a defined food-safety posture.                                                                                                                 | 2         |
| **SEL-6** | Entrepreneur starter flow: a lightweight path to begin with a single product or a small menu, minimising the barrier to first listing.                                                                       | 2         |
| **SEL-7** | Demand-testing: pre-orders, interest signals (“notify me / I’d buy this”), and small capped batches, so an aspiring seller validates demand before producing at scale.                                       | 2         |
| **SEL-8** | AI seller guidance via the conversational agent: suggest pricing from comparable listings, surface regional demand, flag ambient-versus-cold-chain fit, and walk the seller through food-safety attestation. | 2         |
| **SEL-9** | Graduation model: trust and visibility earned through fulfilled orders and ratings, advancing a seller from aspiring, to verified home seller, to established store.                                         | 2         |

### 6.13 Food Quality Assurance

Quality on AfriMart is a layered system rather than an assumption: standards at listing, evidence at packing, feedback after delivery, a score that governs visibility, and an enforcement ladder behind it. It builds on seller verification (SEL-2), quality gating (SEL-4), delivery-issue flagging (NTF-5), and refunds (PAY-4).

| **ID**   | **Requirement**                                                                                                                                                   | **Phase** |
|----------|-------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **QC-1** | Product standards at listing: a prohibited and restricted items policy, labelling requirements, and expiry rules — no short-dated goods without clear disclosure. | 1         |
| **QC-2** | Packing photo confirmation: the merchant photographs the packed order before sealing, creating an evidence trail for every shipment and dispute.                  | 1         |
| **QC-3** | Item-level quality flagging by buyers (damaged, expired, not as described, suspected inauthentic), feeding the refund path and the seller's quality record.       | 1         |
| **QC-4** | Seller quality score aggregating ratings, quality flags, and fulfilment performance, directly driving search ranking and visibility.                              | 1         |
| **QC-5** | Buyer-facing freshness and quality guarantee: a clear money-back promise on items that arrive damaged, expired, or not as described.                              | 1         |
| **QC-6** | Enforcement ladder: automated thresholds moving a seller from warning, to listing suspension, to delisting, administered through the operations console.          | 1         |
| **QC-7** | Operations sampling: periodic test orders placed by the platform to spot-check quality, packaging, and accuracy across sellers.                                   | 2         |

## 7. Non-Functional Requirements

**Performance.** Search must return quickly across a growing multi-store catalogue; checkout, rate-shopping, and feasibility checks must complete without perceptible delay to the buyer.

**Scalability.** The system is a multi-tenant marketplace serving many independent stores and nationwide buyers; catalogue, orders, and routing must scale from tens to hundreds of stores and from hundreds to hundreds of thousands of orders without re-architecture.

**Reliability.** Order integrity is paramount: no order may be silently lost, which is why merchant order alerts carry an SMS fallback behind push. Fulfilment state must remain consistent with carrier reality via webhooks.

**Security.** Card handling is delegated to the payments provider for PCI scope reduction; authentication, authorization, and data protection follow current best practice across buyer, merchant, and admin surfaces.

**Privacy and compliance.** Buyer PII is protected; website ingestion is consent-based (the seller submits their own site); perishable shipping meets food-safety and dry-ice hazmat labelling rules; merchant messaging complies with A2P 10DLC; sales tax follows US nexus rules by jurisdiction.

**Accessibility and localization.** The buyer experience must work for a linguistically diverse audience, and the merchant app must be usable by low-digital-comfort owners on low-end devices. Both surfaces ship as mobile-first progressive web apps in Phase 1 — installable without an app store — with native iOS and Android apps deferred to Phase 3, once traction justifies the added build and release overhead.

**Observability.** Order, fulfilment, and catalogue pipelines must be monitorable, with tracking, error, and confidence signals surfaced to operations.

## 8. System Architecture and Integrations

The architecture is deliberately country- and carrier-agnostic so that later phases (cold-chain, consolidation, Canada, negotiated carriers) are configuration rather than rebuild. It comprises the following components and external integrations.

**Core components**

Buyer application (a mobile-first progressive web app; native iOS and Android deferred to Phase 3); merchant PWA; operations console; a marketplace backend owning users, stores, listings, catalogue, carts, and orders; the routing and optimisation engine; a canonical-resolution and knowledge-graph service; and the AI services layer (vision cataloguing, the conversational and extraction LLM, and embeddings powering search and product matching).

**External integrations**

| **ID**    | **Requirement**                                                                                                                                                                   | **Phase** |
|-----------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-----------|
| **INT-1** | Multi-carrier shipping API (e.g. EasyPost, Shippo, or ShipEngine) for rates, labels, tracking, pickup, and address validation. Selection favours API-first, multi-tenant support. | 1         |
| **INT-2** | Payments and marketplace splitting (e.g. Stripe Connect) for buyer collection, store remittance, refunds, and payouts.                                                            | 1         |
| **INT-3** | SMS provider with A2P 10DLC registration (e.g. Twilio) for merchant alerts and buyer notifications.                                                                               | 1         |
| **INT-4** | Commerce-platform connectors (Shopify, WooCommerce, and similar) for structured catalogue import and two-way sync.                                                                | 1         |
| **INT-5** | URL-to-structured-data extraction service for the unstructured-site onboarding fallback.                                                                                          | 2         |
| **INT-6** | Sales-tax calculation service by US jurisdiction.                                                                                                                                 | 1         |

## 9. High-Level Data Model

The core entities and their relationships, to be detailed in technical design:

| **ID**                | **Requirement**                                                                                                             | **Phase** |
|-----------------------|-----------------------------------------------------------------------------------------------------------------------------|-----------|
| **Store**             | A merchant. Belongs to a supply hub; has onboarding record, listings, orders, payout account, and performance metrics.      | —         |
| **CanonicalProduct**  | A product in the master registry, with canonical name, category, cuisine, pack size, images, temperature class, and weight. | —         |
| **NameAlias**         | An alternate name/spelling/language mapped to a CanonicalProduct; the knowledge graph.                                      | —         |
| **Listing**           | A Store's offer of a CanonicalProduct, with price, stock, and fulfilment attributes.                                        | —         |
| **Buyer**             | A customer, with addresses, order history, and replenishment profile.                                                       | —         |
| **Cart / Order**      | A buyer's basket and its resulting order; an order decomposes into one or more Shipments.                                   | —         |
| **Shipment / Parcel** | A single dispatched package from one Store in one temperature stream, with carrier, label, and tracking.                    | —         |
| **Payment / Payout**  | Buyer charge and per-store remittance net of take rate and fees.                                                            | —         |
| **HubMetro**          | A supply metro anchoring a set of Stores for shipping origination.                                                          | —         |
| **Subscription**      | A recurring box or membership (later phase).                                                                                | —         |

## 10. Release Plan

Requirements above are tagged to the phase in which they are expected to ship. The phases and their exit criteria:

| **Phase**   | **Scope**                                                                                                                                                                                                                                                                                                                                                          | **Exit criteria**                                                       |
|-------------|--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|-------------------------------------------------------------------------|
| **Phase 1** | MVP: filming + structured-import onboarding, merchant app with SMS rail, canonical catalogue and search, cart and single-store-preferring routing, recipe-to-cart, marketplace payments, ambient nationwide shipping, tracking, and the operations console. One supply metro. Includes home-based sellers of shelf-stable goods under a seller-verification layer. | First 1,000 nationwide orders; positive contribution on ambient orders  |
| **Phase 2** | Cold-chain and perishables; second supply metro; anchor-store consolidation; auto-replenishment; curated boxes; AI extraction fallback and two-way sync; fresh and prepared home food; the aspiring-entrepreneur on-ramp with demand-testing and AI seller guidance; Canada expansion groundwork.                                                                  | Repeat-purchase rate above 40%; perishable damage rate within tolerance |
| **Phase 3** | Free-shipping membership tier; brand advertising platform; negotiated carrier contracts; native iOS and Android apps (success-gated); expansion across remaining supply metros.                                                                                                                                                                                    | Membership-driven margin; advertising revenue live                      |

## 11. Risks and Mitigations

**Shipping economics on heavy staples.** Heavy items make per-order shipping expensive. Mitigation: routing-engine basket concentration, a visible free-shipping threshold set from the unit-economics model, and hub selection for carrier-rate advantage. This is the first thing to model before build.

**Customer acquisition cost.** The diaspora is dispersed and heterogeneous. Mitigation: launch demand through a community-insider beachhead (Columbus) via churches, associations, and community channels rather than paid acquisition; lead with cuisine-specific curation.

**Cold-chain reliability.** Perishable failures damage trust disproportionately. Mitigation: defer perishables to Phase 2, restrict to two-day zones, enforce ship-day discipline, and validate insulated packaging before opening the category.

**Supply reliability.** Independent, cash-based stores fulfil inconsistently. Mitigation: habit-fitting order flows with SMS fallback, platform-supplied packaging, and performance-based ranking so reliable stores win more orders.

**Catalogue accuracy.** Mis-identified products erode trust. Mitigation: human-in-the-loop review at onboarding, confidence thresholds, and buyer flagging.

**Home-kitchen food safety and unready sellers.** Opening supply to home kitchens and first-time sellers introduces food-safety liability and the risk of untested listings eroding buyer trust. Mitigation: seller verification and food-safety attestation, shelf-stable-first with fresh food gated on a defined safety posture, demand-testing before scale, and quality-gating so unproven sellers earn visibility through fulfilment and ratings.

**Incumbent entry.** A large ethnic-grocery incumbent could add an African storefront. Mitigation: move fast on the marketplace and multilingual-catalogue moat suited to fragmented, cash-based supply that an inventory-holding incumbent is ill-fit to serve.

## 12. Open Questions and Dependencies

The shipping unit-economics model — the free-shipping threshold and target basket size — is the outstanding analytical prerequisite and blocks final pricing decisions. The Phase 1 supply metro and the initial cohort of 15–20 stores must be confirmed, ideally aligned with the group's own networks. The specific multi-carrier shipping API and payments-splitting provider are to be selected against the marketplace and multi-tenant requirements. Cold-chain packaging must be validated before Phase 2. Per-metro dry-ice sourcing and US tax/entity setup are Phase 2 dependencies to confirm ahead of time.
