# Store onboarding and vision cataloguing: the plan

Status: Parts 1, 2a and 2b are implemented locally. Part 2c has an offline evaluator and labelled placeholders. Real-store evaluation and threshold selection remain pending. Covers PRD ONB-1, ONB-2, ONB-3, ONB-6, ONB-8, CAT-2, CAT-3, CAT-6 and the QC-1 rules as they meet a draft catalogue.

## Where things stand

- **Registration is real.** `/onboarding` uses six-digit codes, saves the owner's details and food-safety attestation, and persists the filming/website preference. Sellers can film shelves or import a WooCommerce feed or Product JSON-LD from their saved website, then review the draft catalogue.
- **Both entry paths are implemented.** Staff can create a pending store, issue a seven-day single-use invitation and record packaging/printer issuance. Self-service creates a pending, unverified store only after a correct code. Public catalogue reads require a live, staff-verified store.
- **Phone ownership is recorded and bound to the code.** `ownerPhoneVerifiedAt` is set by verification; staff reassignment clears it, ends sessions, invalidates invites and increments the phone-assignment version. A previously issued code cannot take over a newly assigned store or become valid if an old number is assigned back.
- **Pieces that exist and will be reused:** one-time codes and paced sending (`auth/signInCodes.ts`), sessions and cookies, the photo store and its signed links, `CatalogueDraft` with a confidence column and the ops review queue (`admin.approveDraft`, CAT-6 threshold), `NameAlias` for the knowledge graph, the QC-1 listing check (`checkListingForStore`), the ops Onboarding tab (hub assignment, status).

Implementation choices for Part 1: a self-service registration gets the first active hub alphabetically as a provisional assignment; operations must confirm or change it. A missing active hub refuses registration. The tighter per-IP signup ceiling applies to all onboarding requests to avoid exposing whether a number exists (five per 15-minute window on each backend instance). Per-number limits span both code purposes and are serialized in PostgreSQL. Invitations use URL fragments and are accepted only after the invited store's owner verifies their phone. An invitation is never a login credential. Phone verification, profile completion and food-safety attestation are required for staff approval; go-live additionally requires a catalogue, an issued kit and an active hub.

Verification entry points: `npm run verify:onboarding --workspace=@afrimart/backend` and `npm run e2e:onboarding`. Migration `20261119090000_store_onboarding` invalidates old store codes and sessions because they were not bound to phone assignments. No existing number is silently marked verified.

Validation on 2026-11-19: the existing 330 backend tests, sign-in integration checks and the initial 12 onboarding regression groups passed. An expanded run subsequently timed out during store creation.

On 2026-11-21, all 13 onboarding regression groups passed against local PostgreSQL. The Chrome walkthrough completed staff-assisted and self-service registration, verified persistence after reload, checked mobile layouts at 320 and 390 pixels, and exercised staff approval, kit recording and refusal to publish without a catalogue. The earlier transaction timeout did not recur.

## Part 1: store onboarding, with the sign-in number set and verified

### The rule

A store's sign-in number is only ever set by one of two things, and is trusted only after a code sent to it has been entered:

1. **Assisted.** A staff member (field rep or remote session) creates the store in the ops console: business name, owner, seller type, hub, owner mobile. The number is stored as *unverified*. The owner opens the app, enters it, receives a code, enters it, and that is the verification.
2. **Self-serve** ("Become a seller", the prototype's first screen). The owner enters a number, receives a code, and on entering it a *pending* store is created with that verified number. It cannot trade: not live, not verified (SEL-2), not routable, invisible to buyers, until staff verify it. Creating a pending row is cheap and harmless; creating anything visible is not possible from this path.

Both use the existing code machinery with one new purpose, so the same limits apply (ten minutes, five guesses, paced per address and per number, per-IP ceiling), plus a lower per-IP ceiling on *new* numbers to blunt someone creating stores in bulk.

### Data

- `Store.ownerPhoneVerifiedAt` (nullable). Set on the first successful code for the number, whichever path. Cleared, with all sessions, when staff change the number.
- `Store.onboardingStartedAt`; the existing `onboardingStatus` stages (`pending` Ã¢â€ â€™ `filming` Ã¢â€ â€™ `reviewing` Ã¢â€ â€™ `kit_issued` Ã¢â€ â€™ `live`) become real transitions rather than labels.
- `OnboardingInvite` for assisted starts: a single-use token (hash only), the store it opens, who made it, an expiry. Delivered as a link or QR code the field rep shows on their own device, so assisted onboarding does not depend on texting the invite. (Texting codes still depends on the 10DLC campaign; see below.)
- ONB-8 kit record: packaging issued, label printer serial, issue date, who recorded it.

### Behaviour that matters

- A number that already belongs to a store keeps the same account when it uses signup, and nothing says it was already registered. The code purpose follows the entry point. Ordinary sign-in still sends nothing to unknown store numbers.
- Sign-in is allowed only for a verified number. A number staff set but the owner has not yet verified can still receive a code (that is how it gets verified), and a successful code both verifies and signs in.
- Changing the number is the same audited staff action as today, now also clearing `ownerPhoneVerifiedAt`.
- ONB-1's "digital maturity" question (do you have a website? a Shopify store?) picks the rail: filming (ONB-2) or website import (ONB-4). ONB-4 is its own piece of work and is not part of this plan.

### Built in this order

1. Schema, invite, verification fields, and the code purpose. Tests: the verification rules above, bulk-creation limits, an unverified number cannot be used to take over a store.
2. Ops console: create a store with an owner number, issue an invite, record the kit (ONB-8), show verified or unverified.
3. Merchant app: real welcome and code screens replacing the mock, picking up the sign-in screen already built. Stage moves from `pending` to `filming` when the owner is verified and has chosen the rail.

## Part 2: ONB-2 vision cataloguing

### Capture (ONB-3), in the browser

Film the shelves with the camera. In the browser, sample frames about twice a second, score each for sharpness (variance of a Laplacian on a downscaled copy), size of the subject, and exposure, and prompt the owner in the prototype's words: closer, slower, more light. Keep the best frame per stretch of shelf (a perceptual hash separates repeats), cap at about 60 frames, downscale to 1600px on the long edge, and upload JPEG frames, not video. Frames go through the same photo store: re-encoded, stripped of metadata, private, a new kind `shelf`, deleted according to the per-photo deadline below.

A `FilmSession` row groups the frames for one store and one attempt, so "re-shoot a shelf" (the prototype's redo pass) replaces frames rather than adding to them.

**Part 2a implementation.** A verified seller with a completed profile and the filming preference opens `/onboarding/shelves`. The browser evaluates exposure, Laplacian variance, and the spread of edges around the centre, then keeps the sharpest candidate for each distinct view. The seller saves each shelf as a unit and can resume or replace it before finishing. The server enforces a 60-frame session limit. A replacement commits only after every new JPEG has been sanitised and stored. Superseded or interrupted uploads are tracked for cleanup on save and server startup. Finishing leaves a private session available for Part 2b.

The local browser check is `npm run e2e:shelves`. Image-quality cutoffs are provisional until the real-store evaluation. Each shelf photo is due for deletion when its final linked draft is resolved or 30 days after upload, whichever comes first. Merged drafts carry their evidence forward. The upload time is immutable. For older photos without a recorded upload time, the migration uses the capture session’s start as a conservative lower bound.

The API checks the deadline before serving shelf photos, including previously signed links. The backend runs cleanup at startup and continuously, independent of extraction, and keeps a deletion record until storage confirms the object is gone. A failed delete retries automatically. Expiry also covers abandoned captures, failed extractions and open staff reviews. Staff can request a fresh photo on the open draft. The seller receives a message and uploads it from catalogue review. Each replacement gets its own upload time. Run `npm run verify:shelf-retention` against local PostgreSQL to exercise this lifecycle using an isolated schema and real files. With the merchant and ops dev servers running on ports 3001 and 3002 and port 4000 free, add `-- --browser` to exercise the staff request and seller upload in Chrome.

### Running the Part 2c shelf evaluation

Run `npm run eval:shelves` from the repository root. It generates 36 placeholder JPEGs in memory, replays scripted product readings through the catalogue matcher and checks camera guidance on the decoded images. Six shelf captures provide 18 calibration frames and six separate captures provide 18 validation frames. The script requires no provider credentials or database connection.

To inspect the images and labels, run `npm run eval:shelves -- --write-placeholders tmp/shelf-evaluation/example --report tmp/shelf-evaluation/report.json` with fresh output paths. Replay an exported set with `npm run eval:shelves -- --dataset tmp/shelf-evaluation/example/manifest.json`. Run regression checks with `npm run test:shelf-evaluation`.

The manifest records the data source, catalogue SKUs and capture split. For each capture, label the expected camera guidance per image, product names, pack size, optional brand, SKU, price in cents and zero-based supporting frame indices. A null price means unreadable. Each capture references a JSON recording with the reader model, ordered frame SHA-256 hashes and readings per batch (up to four images). If matching needs embeddings, include `embeddingModel` and the recorded `embeddings.query` and `embeddings.document` vectors keyed by the exact input text. Keep photos, labels and recordings together in the ignored local directory. For real evaluation, collect independent calibration and validation captures and record actual provider outputs.

The baseline counts product detection precision and recall, correct prices across all legible labelled products, and incorrect draft pre-selections. Each missed legible tag counts against price accuracy. Trial cutoffs are chosen only on calibration captures and checked on held-out captures. Placeholder results exercise the scorer. The default production cutoff remains 0.92 pending evaluation on real-store photos.

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

**Part 2b implementation.** Finishing a capture queues one durable job. Live reading is opt-in. The worker claims a lease, reads four frames per batch, validates frame references and leaves unreadable prices empty. A seller must review or refer every draft. Publication runs QC-1 again inside the listing transaction. Staff can resolve referred items, correct their prices and explicitly adopt a seller's corrected name as a canonical alias. Shelf photos are detached for deletion after the last outstanding item is resolved. Existing draft queues remain supported.

The local walkthrough `npm run e2e:catalogue` exercises the provider adapters with recorded responses and verifies review in a mobile browser. Model selection, provider terms, real-store accuracy and the approved live spending budget remain deployment decisions.

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
  1. Implemented: both assisted and self-service registration as above; home sellers can register without a field rep.
  2. Who verifies a pending store (SEL-2), and how quickly. This is the gate between onboarding and trading.
  3. Shelf-frame retention is decided and implemented as described above.
  4. A per-store budget for reading (a number of cents), so a runaway case cannot spend without limit.
  5. Whether the owner's data may go to the vision provider under its zero-retention terms (check the account's agreement).
- **Material:** 30 to 50 labelled shelf photos from real stores, including difficult ones (glare, handwritten tags, shelves in other languages), for the evaluation set.
- **Still open from before:** the 10DLC campaign (texted codes), a real email provider (buyer codes and notifications).
