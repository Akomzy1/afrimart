# Store onboarding and vision cataloguing: the plan

Status: planned, not started (2026-10-15). Covers PRD ONB-1, ONB-2, ONB-3, ONB-6, ONB-8, CAT-2, CAT-3, CAT-6 and the QC-1 rules as they meet a draft catalogue.

## Where things stand

- **The merchant app's `/onboarding` is a mock.** Its phone and code steps, film capture, "reading" and review screens are the prototype's, with sample products. Nothing on the server creates a store, verifies a number or reads a shelf.
- **Stores exist only because someone inserted them.** `Store.ownerPhone` is set only by staff in the ops console (audited, ends sessions). Sign-in proves control of that number on every sign-in, but nothing records that it was ever verified or when.
- **Pieces that exist and will be reused:** one-time codes and paced sending (`auth/signInCodes.ts`), sessions and cookies, the photo store and its signed links, `CatalogueDraft` with a confidence column and the ops review queue (`admin.approveDraft`, CAT-6 threshold), `NameAlias` for the knowledge graph, the QC-1 listing check (`checkListingForStore`), the ops Onboarding tab (hub assignment, status).

## Part 1: store onboarding, with the sign-in number set and verified

### The rule

A store's sign-in number is only ever set by one of two things, and is trusted only after a code sent to it has been entered:

1. **Assisted.** A staff member (field rep or remote session) creates the store in the ops console: business name, owner, seller type, hub, owner mobile. The number is stored as *unverified*. The owner opens the app, enters it, receives a code, enters it, and that is the verification.
2. **Self-serve** ("Become a seller", the prototype's first screen). The owner enters a number, receives a code, and on entering it a *pending* store is created with that verified number. It cannot trade: not live, not verified (SEL-2), not routable, invisible to buyers, until staff verify it. Creating a pending row is cheap and harmless; creating anything visible is not possible from this path.

Both use the existing code machinery with one new purpose, so the same limits apply (ten minutes, five guesses, paced per address and per number, per-IP ceiling), plus a lower per-IP ceiling on *new* numbers to blunt someone creating stores in bulk.

### Data

- `Store.ownerPhoneVerifiedAt` (nullable). Set on the first successful code for the number, whichever path. Cleared, with all sessions, when staff change the number.
- `Store.onboardingStartedAt`; the existing `onboardingStatus` stages (`pending` → `filming` → `reviewing` → `kit_issued` → `live`) become real transitions rather than labels.
- `OnboardingInvite` for assisted starts: a single-use token (hash only), the store it opens, who made it, an expiry. Delivered as a link or QR code the field rep shows on their own device, so assisted onboarding does not depend on texting the invite. (Texting codes still depends on the 10DLC campaign; see below.)
- ONB-8 kit record: packaging issued, label printer serial, issue date, who recorded it.

### Behaviour that matters

- A number that already belongs to a store gets the ordinary sign-in code, and nothing says it was already registered. A number that does not exist and is not in the self-serve path says what an unknown number says today.
- Sign-in is allowed only for a verified number. A number staff set but the owner has not yet verified can still receive a code (that is how it gets verified), and a successful code both verifies and signs in.
- Changing the number is the same audited staff action as today, now also clearing `ownerPhoneVerifiedAt`.
- ONB-1's "digital maturity" question (do you have a website? a Shopify store?) picks the rail: filming (ONB-2) or website import (ONB-4). ONB-4 is its own piece of work and is not part of this plan.

### Built in this order

1. Schema, invite, verification fields, and the code purpose. Tests: the verification rules above, bulk-creation limits, an unverified number cannot be used to take over a store.
2. Ops console: create a store with an owner number, issue an invite, record the kit (ONB-8), show verified or unverified.
3. Merchant app: real welcome and code screens replacing the mock, picking up the sign-in screen already built. Stage moves from `pending` to `filming` when the owner is verified and has chosen the rail.

## Part 2: ONB-2 vision cataloguing

### Capture (ONB-3), in the browser

Film the shelves with the camera. In the browser, sample frames about twice a second, score each for sharpness (variance of a Laplacian on a downscaled copy), size of the subject, and exposure, and prompt the owner in the prototype's words: closer, slower, more light. Keep the best frame per stretch of shelf (a perceptual hash separates repeats), cap at about 60 frames, downscale to 1600px on the long edge, and upload JPEG frames, not video. Frames go through the same photo store: re-encoded, stripped of metadata, private, a new kind `shelf`, deleted after publishing (retention below).

A `FilmSession` row groups the frames for one store and one attempt, so "re-shoot a shelf" (the prototype's redo pass) replaces frames rather than adding to them.

### Reading

A background job per session, backed by a `ExtractionJob` table (claimed with `FOR UPDATE SKIP LOCKED`, so no queue service is needed at first). For batches of frames it calls the Anthropic Messages API with the images and a fixed output schema through tool use: for each product visible, the raw text as printed, name, brand, pack size, shelf-tag price if legible, a confidence, and which frames showed it. Where the model cannot read a price it says so; it is never asked to guess one.

- The same product seen in several frames is merged by normalised name, pack size and price, keeping every frame reference.
- The model and its settings are configuration. Start with a mid-tier vision model; measure; use a cheaper one for easy frames if the evaluation (below) allows. A per-store daily cost cap and a global kill switch are part of the first version.
- Every call's input size, output, latency and cost is logged, so the unit cost per store is known before it matters.

### Resolving to the catalogue (CAT-2, CAT-3)

Each merged product's raw string is matched to a canonical product: first an exact or near-exact match in `NameAlias` (the knowledge graph), then Voyage multilingual embeddings against canonical names, aliases and pack sizes for the top few candidates with similarity scores. Above the threshold it is matched; between thresholds the owner is shown the candidates; below, it goes to the ops queue as a proposed canonical product (ADM-4). Matching a spelling in Yoruba, Igbo, Twi, Amharic, Swahili, French or phonetic English is why the alias table is worth seeding before launch, with the owner's corrections feeding back into it.

### Confidence and review (CAT-6, ONB-6)

A draft's confidence combines the reading confidence, the match similarity and whether a price was legible. Under the existing threshold nothing is auto-approved; the owner reviews every draft in the app regardless (ONB-6), and low-confidence items are marked for a closer look first. The owner's screen shows their own frame beside each item, price steppers (as in the prototype), and removes or merges. Staff see only what the owner could not settle.

### Publishing and the QC-1 rules

Publishing goes through `checkListingForStore`, the same check every listing path uses, so a draft in meat, poultry, fish or dairy asks for the one-time permit confirmation, a chilled or frozen item for a home seller is blocked unless the licence counts, and a category switched off for them refuses with the same words. The owner is told at review, item by item, not after the fact. A listing still reaches buyers only for a store that is verified and live.

### Testing

- A recorded-response mode: the extraction step reads saved model responses, so CI makes no API calls and the pipeline (merge, resolve, route, publish) is fully tested.
- A labelled evaluation set of real shelf photos from you, scored for product recall and precision, price accuracy, and how often a wrong item would have been auto-approved. The last number is the one that gates launch; it must be zero at the chosen threshold on the set.
- The same fixture photos used to test the capture's frame scoring.

## Order of work and rough size

| Part | Work | About |
|---|---|---|
| 1 | Store onboarding, verified number, invite, kit record, real welcome and code screens | 1 week |
| 2a | Capture with quality scoring, frame upload, film session | 1 week |
| 2b | Extraction job, merging, resolution, confidence routing, review screens wired, QC-1 at publish | 2 weeks |
| 2c | Evaluation set, thresholds, cost caps, hardening | 1 week |

Part 1 can ship alone and is what lets a real store sign in. Part 2 depends on part 1 only for a verified owner.

## What this needs from you

- **Keys and accounts:** an Anthropic API key and a Voyage key (the `.env.example` names are already there); the S3 or R2 bucket for frames (the same one as licence photos, under its own prefix).
- **Decisions:**
  1. Self-serve "Become a seller", assisted-only for stores, or both as above. Home sellers have no field rep, so they need self-serve.
  2. Who verifies a pending store (SEL-2), and how quickly. This is the gate between onboarding and trading.
  3. Retention for shelf frames. Proposal: delete the frames when the draft is published or abandoned, and in any case after 30 days. They can show people and homes.
  4. A per-store budget for reading (a number of cents), so a runaway case cannot spend without limit.
  5. Whether the owner's data may go to the vision provider under its zero-retention terms (check the account's agreement).
- **Material:** 30 to 50 labelled shelf photos from real stores, including difficult ones (glare, handwritten tags, shelves in other languages), for the evaluation set.
- **Still open from before:** the 10DLC campaign (texted codes), a real email provider (buyer codes and notifications).
