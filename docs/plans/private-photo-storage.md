# Private photo storage

Status: built (2026-10-15). Waiting only on your bucket and credentials.

## What is being protected

| Photo | Who took it | What it can reveal | Who may see it |
|---|---|---|---|
| Licence or badge document | Seller | Licence number, a home address, business registration | The seller; staff with `stores:read` (audited) |
| Claim photo | Buyer | The parcel, often the delivery address label | The buyer who filed it; staff with `finance:read` (audited) |
| Packing photo | Seller | The inside of a box, sometimes a kitchen or shop | The seller who packed it; staff with `finance:read` (audited) |

Photos are re-encoded with all metadata removed before they are kept. That removes GPS and device data from the file. It does not remove what is visible in the picture, which is why access is restricted.

## How access works

1. The database holds a storage path (`/photos/<kind>/<random>.jpg`), never a link. Nothing returns that path to a client.
2. A procedure decides whether the caller may see this photo: the signed-in seller or buyer through their own rows, or staff through a named permission. Only then does it return a link signed for that one file, valid for five minutes (`PHOTO_URL_TTL_SECONDS`).
3. The API's picture route serves nothing without a valid, unexpired signature for exactly that file. It fetches the bytes from the bucket with the server's own credentials and streams them back. Bad, missing, expired or wrong-file signatures all get the same 404 as a file that does not exist. Responses are `no-store`.
4. Every staff view is written to the audit log (`photo.view`) when the link is issued: who, which photo, which report or application. Buyers and sellers viewing their own photos are not audited.
5. Staff tables show that a photo exists, not the photo. Opening one is a deliberate click.

The bucket is never read by a browser. There are no presigned bucket URLs, so there is one place access is decided and one place it is audited, and the bucket can have no public access at all. The cost is that image bytes pass through the API; at this volume that is fine, and presigned bucket URLs remain an option if it ever is not.

## Where photos live

An S3-compatible bucket, chosen by configuration: AWS S3, Cloudflare R2, or MinIO. The adapter (`storage/s3.ts`) speaks the S3 REST API with Signature Version 4 directly, with no SDK. Its signer is checked against AWS's published worked examples, and against a real MinIO server by `npm run verify:storage`.

| Variable | Meaning |
|---|---|
| `S3_BUCKET`, `S3_ACCESS_KEY_ID`, `S3_SECRET_ACCESS_KEY` | Required together. Setting some but not all stops the server rather than falling back to disk. |
| `S3_ENDPOINT` | R2: `https://<account-id>.r2.cloudflarestorage.com`. MinIO: `http://localhost:9100`. Leave unset for AWS. Plain `http` is accepted only for localhost. |
| `S3_REGION` | AWS region. Defaults to `auto` for R2 and `us-east-1` otherwise. |
| `S3_KEY_PREFIX` | Optional folder inside the bucket. |
| `S3_SERVER_SIDE_ENCRYPTION` | `AES256` or `aws:kms` for S3. R2 encrypts at rest itself; leave it unset there. |

With none of them set, photos go to `.uploads/` on this machine. That is for development only: the server will not start outside development without a bucket, and licence documents are refused wherever storage is not durable.

### Setting up the bucket (once, by a person)

1. Create a private bucket in the US region you choose. On AWS, turn on Block Public Access for all four settings. On R2, do not attach a public domain or enable the r2.dev URL.
2. Scope the access key to the private bucket. Shelf cleanup needs to confirm a missing object by HEAD/GET. On AWS, grant the appropriate bucket list permission for a missing key to return 404. With versioning, grant `s3:DeleteObjectVersion` for the shelf prefix so the worker can erase earlier versions as well as the current one. Object Lock or an external retention rule that prevents deletion is incompatible with the shelf-photo deadline.
3. Set the variables above on the backend only. They never go to the apps.
4. Start the server. At start-up it writes a probe object, asks for it with no credentials, and removes it; if the bucket answers an anonymous request it refuses to start.

### Moving what is already on disk

`npm run migrate:photos --workspace=@afrimart/backend` copies the `.uploads/` folder into the bucket, keeping each name so no database row changes. It reads every copy back and compares it, never overwrites a differing file (it reports it), never deletes anything, and copies nothing the second time. Run it with `-- --dry-run` first.

## What is left

1. **Retention.** Decide how long a licence photo is kept after a decision and after revocation, and how a seller's photos are removed on request. Not decided; it needs a policy, then a scheduled delete that is itself audited.
2. **Staff access review.** `operations` and `finance` hold photo access today. Confirm both need it, and who can read the `photo.view` entries (`audit:read`).
3. **Lifecycle rules** on the bucket, once retention is decided.

## Decisions needed from you

- Retention period for licence and claim photos.
- Whether sellers should be able to view their own submitted licence photo (no screen asks for it today, so it is not built).
- Which provider, and the region.
