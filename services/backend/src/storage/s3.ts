import { createHash, createHmac, randomBytes } from "node:crypto";
import { PHOTO_KINDS, PHOTO_NAME, sanitizePhoto, type PhotoKind, type PhotoStore } from "./photos.js";

/**
 * Durable private photo storage over the S3 API, so AWS S3, Cloudflare R2 and
 * MinIO all work by configuration alone.
 *
 * Written against the REST API directly (Signature Version 4) rather than an
 * SDK. The surface is four calls (put, get, head, delete), which keeps a few
 * hundred packages out of a service that handles licence documents; the
 * signer is checked against the examples AWS publishes in its documentation
 * (s3.test.ts) and against a real MinIO server (verify-storage.ts).
 *
 * Nothing here is ever public. Objects are written with no ACL and no public
 * URL is ever built from them; reads go through the API's signed-link route
 * (route.ts), which fetches the bytes with the server's own credentials. A
 * start-up check (assertBucketPrivate) refuses to run against a bucket that
 * serves its objects to an anonymous request.
 *
 * Configuration, all from the environment:
 *   S3_BUCKET, S3_ACCESS_KEY_ID, S3_SECRET_ACCESS_KEY   required
 *   S3_ENDPOINT   for R2 (https://<account>.r2.cloudflarestorage.com) or MinIO
 *                 (http://localhost:9000); leave unset for AWS S3
 *   S3_REGION     AWS region; defaults to "auto" for R2 and "us-east-1" otherwise
 *   S3_KEY_PREFIX optional folder inside the bucket, e.g. "photos/"
 *   S3_FORCE_PATH_STYLE=yes   AWS only; a custom endpoint is always path-style
 *   S3_SERVER_SIDE_ENCRYPTION AES256 or aws:kms, for S3 (R2 encrypts at rest itself)
 */

export interface S3Config {
  bucket: string;
  region: string;
  /** Null for AWS S3 itself. */
  endpoint: string | null;
  accessKeyId: string;
  secretAccessKey: string;
  forcePathStyle: boolean;
  /** Empty, or a folder ending in "/". */
  keyPrefix: string;
  serverSideEncryption: string | null;
}

const REQUIRED = ["S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY"] as const;
const LOOPBACK = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "host.docker.internal"]);

/** Null when no S3 variable is set at all; a clear error when some are set and not enough. */
export function s3ConfigFromEnv(env: NodeJS.ProcessEnv = process.env): S3Config | null {
  const any = [...REQUIRED, "S3_ENDPOINT", "S3_REGION"].some((k) => env[k]);
  if (!any) return null;
  const missing = REQUIRED.filter((k) => !env[k]);
  if (missing.length) throw new Error(`S3 storage is partly configured. Also set: ${missing.join(", ")}.`);

  const bucket = env.S3_BUCKET!;
  if (!/^[a-z0-9][a-z0-9.-]{1,61}[a-z0-9]$/.test(bucket)) throw new Error(`S3_BUCKET "${bucket}" is not a valid bucket name.`);

  const endpoint = env.S3_ENDPOINT ? env.S3_ENDPOINT.replace(/\/+$/, "") : null;
  if (endpoint) {
    const url = new URL(endpoint);
    // Credentials never travel over plain HTTP to anything but this machine.
    if (url.protocol !== "https:" && !(url.protocol === "http:" && LOOPBACK.has(url.hostname))) {
      throw new Error("S3_ENDPOINT must be https, except for a local MinIO on localhost.");
    }
  }
  const region = env.S3_REGION || (endpoint && new URL(endpoint).hostname.endsWith("r2.cloudflarestorage.com") ? "auto" : "us-east-1");
  const prefix = (env.S3_KEY_PREFIX ?? "").replace(/^\/+/, "");

  return {
    bucket,
    region,
    endpoint,
    accessKeyId: env.S3_ACCESS_KEY_ID!,
    secretAccessKey: env.S3_SECRET_ACCESS_KEY!,
    forcePathStyle: endpoint !== null || env.S3_FORCE_PATH_STYLE === "yes",
    keyPrefix: prefix && !prefix.endsWith("/") ? `${prefix}/` : prefix,
    serverSideEncryption: env.S3_SERVER_SIDE_ENCRYPTION || null,
  };
}

/* --------------------------------------------------- Signature Version 4 */

const sha256 = (data: string | Buffer) => createHash("sha256").update(data).digest("hex");
const hmac = (key: string | Buffer, data: string) => createHmac("sha256", key).update(data).digest();

/** RFC 3986 encoding, as S3 wants it: everything but unreserved characters, `/` kept in a path. */
function uriEncode(value: string, keepSlash: boolean): string {
  const encoded = encodeURIComponent(value).replace(/[!'()*]/g, (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`);
  return keepSlash ? encoded.replace(/%2F/g, "/") : encoded;
}

export interface SignInput {
  method: string;
  /** The Host header value, port included when it is not the default. */
  host: string;
  /** The unencoded path, starting with "/". */
  path: string;
  query?: Record<string, string>;
  /** Extra headers to send and sign (lower-case names). Host and the x-amz-* basics are added here. */
  headers?: Record<string, string>;
  /** Hex SHA-256 of the body ("UNSIGNED-PAYLOAD" is not used: bodies are small and always hashed). */
  payloadHash: string;
  region: string;
  accessKeyId: string;
  secretAccessKey: string;
  date: Date;
}

export interface Signed {
  /** Every header to send, including Authorization. */
  headers: Record<string, string>;
  canonicalRequest: string;
  stringToSign: string;
  signature: string;
}

export function signRequest(input: SignInput): Signed {
  const amzDate = input.date.toISOString().replace(/[-:]|\.\d{3}/g, "");
  const dateStamp = amzDate.slice(0, 8);
  const scope = `${dateStamp}/${input.region}/s3/aws4_request`;

  const headers: Record<string, string> = {
    ...(input.headers ?? {}),
    host: input.host,
    "x-amz-content-sha256": input.payloadHash,
    "x-amz-date": amzDate,
  };
  const names = Object.keys(headers).sort();
  const canonicalHeaders = names.map((n) => `${n}:${headers[n]!.trim().replace(/\s+/g, " ")}\n`).join("");
  const signedHeaders = names.join(";");

  const query = Object.entries(input.query ?? {})
    .map(([k, v]) => [uriEncode(k, false), uriEncode(v, false)] as const)
    .sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : a[1] < b[1] ? -1 : 1))
    .map(([k, v]) => `${k}=${v}`)
    .join("&");

  const canonicalRequest = [input.method, uriEncode(input.path, true), query, canonicalHeaders, signedHeaders, input.payloadHash].join("\n");
  const stringToSign = ["AWS4-HMAC-SHA256", amzDate, scope, sha256(canonicalRequest)].join("\n");
  const key = hmac(hmac(hmac(hmac(`AWS4${input.secretAccessKey}`, dateStamp), input.region), "s3"), "aws4_request");
  const signature = createHmac("sha256", key).update(stringToSign).digest("hex");

  return {
    headers: {
      ...headers,
      authorization: `AWS4-HMAC-SHA256 Credential=${input.accessKeyId}/${scope},SignedHeaders=${signedHeaders},Signature=${signature}`,
    },
    canonicalRequest,
    stringToSign,
    signature,
  };
}

/* ------------------------------------------------------------- the client */

export class S3Error extends Error {
  constructor(readonly status: number, message: string) {
    super(message);
  }
}

const TIMEOUT_MS = 15_000;

export class S3Client {
  constructor(
    readonly config: S3Config,
    private readonly fetchImpl: typeof fetch = fetch,
    private readonly clock: () => Date = () => new Date(),
  ) {}

  /** Where an object lives: path-style (`host/bucket/key`) or virtual-hosted (`bucket.host/key`). */
  private target(key: string): { url: URL; host: string; path: string } {
    const { bucket, endpoint, region, forcePathStyle } = this.config;
    if (endpoint) {
      const base = new URL(endpoint);
      const path = `${base.pathname.replace(/\/+$/, "")}/${bucket}/${key}`;
      return { url: new URL(`${base.protocol}//${base.host}${uriEncode(path, true)}`), host: base.host, path };
    }
    const host = forcePathStyle ? `s3.${region}.amazonaws.com` : `${bucket}.s3.${region}.amazonaws.com`;
    const path = forcePathStyle ? `/${bucket}/${key}` : `/${key}`;
    return { url: new URL(`https://${host}${uriEncode(path, true)}`), host, path };
  }

  private async send(method: string, key: string, body: Buffer | null = null, headers: Record<string, string> = {}): Promise<Response> {
    const { url, host, path } = this.target(key);
    const payload = body ?? Buffer.alloc(0);
    const signed = signRequest({
      method,
      host,
      path,
      // The length is signed along with everything else, so a body cannot be swapped for a longer or shorter one in transit.
      headers: body ? { ...headers, "content-length": String(payload.length) } : headers,
      payloadHash: sha256(payload),
      region: this.config.region,
      accessKeyId: this.config.accessKeyId,
      secretAccessKey: this.config.secretAccessKey,
      date: this.clock(),
    });
    // `host` is set by fetch itself from the URL; sending it as well is refused.
    const { host: _host, ...toSend } = signed.headers;
    let last: unknown;
    for (let attempt = 0; attempt < 2; attempt++) {
      try {
        const res = await this.fetchImpl(url, { method, headers: toSend, body: body ? new Uint8Array(body) : undefined, signal: AbortSignal.timeout(TIMEOUT_MS) });
        if (res.status >= 500 && attempt === 0) continue; // one retry; every call here is idempotent
        return res;
      } catch (e) {
        last = e;
      }
    }
    throw new S3Error(0, `The photo store could not be reached: ${(last as Error)?.message ?? "unknown error"}`);
  }

  async putObject(key: string, body: Buffer, contentType: string): Promise<void> {
    const headers: Record<string, string> = { "content-type": contentType };
    if (this.config.serverSideEncryption) headers["x-amz-server-side-encryption"] = this.config.serverSideEncryption;
    const res = await this.send("PUT", key, body, headers);
    if (!res.ok) throw new S3Error(res.status, `The photo store refused a write (${res.status}).`);
  }

  /** The object's bytes, or null if there is no such object. Any other failure throws. */
  async getObject(key: string): Promise<Buffer | null> {
    const res = await this.send("GET", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new S3Error(res.status, `The photo store refused a read (${res.status}).`);
    return Buffer.from(await res.arrayBuffer());
  }

  async headObject(key: string): Promise<{ size: number } | null> {
    const res = await this.send("HEAD", key);
    if (res.status === 404) return null;
    if (!res.ok) throw new S3Error(res.status, `The photo store refused a lookup (${res.status}).`);
    return { size: Number(res.headers.get("content-length") ?? 0) };
  }

  async deleteObject(key: string): Promise<void> {
    const res = await this.send("DELETE", key);
    if (!res.ok && res.status !== 404) throw new S3Error(res.status, `The photo store refused a delete (${res.status}).`);
  }

  /**
   * Create the bucket if it does not exist. For local development and tests
   * against MinIO; in production the bucket is made once by a person, with
   * public access blocked, and this is never called.
   */
  async ensureBucket(): Promise<void> {
    const res = await this.send("PUT", "");
    if (!res.ok && res.status !== 409) throw new S3Error(res.status, `Could not create the bucket (${res.status}).`);
  }

  /** The HTTP status an unauthenticated request for this object gets. Anything but 200 means it is not public. */
  async anonymousStatus(key: string): Promise<number> {
    const { url } = this.target(key);
    const res = await this.fetchImpl(url, { method: "GET", signal: AbortSignal.timeout(TIMEOUT_MS) });
    await res.arrayBuffer().catch(() => undefined);
    return res.status;
  }
}

/**
 * Refuse to run against a bucket that hands objects to anyone who asks.
 * Writes a probe object, asks for it with no credentials, and removes it. Run at
 * start-up, so a bucket left public by mistake stops the server rather than
 * quietly exposing licences.
 */
export async function assertBucketPrivate(client: S3Client): Promise<void> {
  const key = `${client.config.keyPrefix}.private-check/${randomBytes(8).toString("hex")}`;
  await client.putObject(key, Buffer.from("private"), "text/plain");
  try {
    const status = await client.anonymousStatus(key);
    if (status === 200) {
      throw new Error(`The photo bucket "${client.config.bucket}" serves objects to anonymous requests. Block public access on it before storing photos.`);
    }
  } finally {
    await client.deleteObject(key).catch(() => undefined);
  }
}

/* ------------------------------------------------------------ photo store */

export class S3PhotoStore implements PhotoStore {
  /** Survives a redeploy, and private by construction (see the header). */
  readonly durable = true;

  constructor(readonly client: S3Client) {}

  private key(kind: PhotoKind, name: string): string {
    return `${this.client.config.keyPrefix}${kind}/${name}`;
  }

  /** Same contract as the local store: sanitise first, store under a random name, return the path. */
  async removeShelfFrame(name: string): Promise<void> {
    if (!PHOTO_NAME.test(name)) throw new Error("Invalid shelf photo name");
    await this.client.deleteObject(this.key("shelf", name));
  }

  async put(kind: PhotoKind, upload: Buffer, name = `${randomBytes(16).toString("hex")}.jpg`): Promise<string> {
    if (!PHOTO_NAME.test(name)) throw new Error("Invalid photo name");
    const clean = await sanitizePhoto(upload, kind === "shelf" ? 1600 : undefined);
    await this.client.putObject(this.key(kind, name), clean, "image/jpeg");
    return `/photos/${kind}/${name}`;
  }

  async read(kind: PhotoKind, name: string): Promise<Buffer | null> {
    // Both parts are validated against fixed shapes, so no input can name another key.
    if (!PHOTO_KINDS.includes(kind) || !PHOTO_NAME.test(name)) return null;
    return this.client.getObject(this.key(kind, name));
  }

  /** For moving files that are already sanitised (migrate-photos-to-s3): the same key, bytes untouched. */
  async copyIn(kind: PhotoKind, name: string, bytes: Buffer): Promise<void> {
    if (!PHOTO_KINDS.includes(kind) || !PHOTO_NAME.test(name)) throw new Error(`Not a stored photo: ${kind}/${name}`);
    await this.client.putObject(this.key(kind, name), bytes, "image/jpeg");
  }

  async has(kind: PhotoKind, name: string): Promise<boolean> {
    return (await this.client.headObject(this.key(kind, name))) !== null;
  }
}
