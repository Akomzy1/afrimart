# Private photo storage

Status: access control built (2026-10-15). Durable storage not built; it is the gate for real licence documents.

## What is being protected

| Photo | Who took it | What it can reveal | Who may see it |
|---|---|---|---|
| Licence or badge document | Seller | Licence number, a home address, business registration | The seller; staff with `stores:read` (audited) |
| Claim photo | Buyer | The parcel, often the delivery address label | The buyer who filed it; staff with `finance:read` (audited) |
| Packing photo | Seller | The inside of a box, sometimes a kitchen or shop | The seller who packed it; staff with `finance:read` (audited) |

Photos are re-encoded with all metadata removed before they are kept (done already). That removes GPS and device data from the file. It does not remove what is visible in the picture, which is why access is restricted.

## How access works

1. The database holds a storage key, never a link. Nothing returns that key to a client.
2. A procedure decides whether the caller may see this photo: the signed-in seller or buyer through their own rows, or staff through a named permission. Only then does it return a link signed for that one file, valid for five minutes (`PHOTO_URL_TTL_SECONDS`).
3. The picture route serves nothing without a valid, unexpired signature for exactly that file. Bad, missing, expired or wrong-file signatures all get the same 404 as a file that does not exist. Responses are `no-store`, so a browser or proxy does not keep a copy past the link.
4. Every staff view is written to the audit log (`photo.view`) when the link is issued: who, which photo, which report or application. Buyers and sellers viewing their own photos are not audited.
5. Staff tables show that a photo exists, not the photo. Opening one is a deliberate click.

## What is built

- Signing, the route, per-role link procedures, audit entries, and tests for each (`storage/access.ts`, `storage/route.ts`, `admin.claimPhotoLinks`, `admin.evidencePhotoLink`, `verify:sign-in`).
- The `PhotoStore` port has a `durable` flag. Licence documents are refused anywhere that looks like production unless the store is durable (`assertCanKeepDocuments`). Real sellers cannot send a licence photo until the next section is done.
- `PHOTO_URL_SECRET` (32 or more characters) must be set outside development; the server will not start without it.

## What is left, in order

1. **Object store adapter** (S3 or R2) implementing `PhotoStore` with `durable = true`: a private bucket with public access blocked, server-side encryption, and no public URLs. Keys stay `kind/random-name.jpg`, so no database migration is needed.
2. **Provider-signed links.** With an object store, `signedPhotoUrl` should return the provider's presigned GET URL (same five-minute life) and the local picture route goes away. Callers do not change.
3. **Move claim and packing photos too.** They are accepted today onto the local disk, which a redeploy would erase. Same adapter, no gate needed beyond `durable`.
4. **Retention.** Decide how long a licence photo is kept after a decision and after revocation, and how a seller's photos are removed on request. Not decided; needs a policy, then a scheduled delete that is itself audited.
5. **Ops access review.** Staff roles are `operations` and `finance` today. Confirm both need photo access, and who can read the `photo.view` entries (`audit:read`).

## Decisions needed from you

- Retention period for licence and claim photos.
- Whether sellers should be able to view their own submitted licence photo (no screen asks for it today, so it is not built).
- Which object store, and the region (US).
