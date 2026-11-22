import { existsSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import { parseEnv } from "node:util";

// Read-only configuration inventory. Never print values or provider error bodies:
// database URLs and service errors can contain credentials.
const root = new URL("../", import.meta.url);
let failures = 0;
function report(status, name, detail) {
  console.log(`[${status}] ${name}: ${detail}`);
  if (status === "FAIL") failures++;
}
function readEnv(relative) {
  const file = new URL(relative, root);
  if (!existsSync(file)) return {};
  try {
    return parseEnv(readFileSync(file, "utf8"));
  } catch {
    report("FAIL", relative, "could not read or parse the environment file");
    return {};
  }
}
const backend = { ...readEnv("services/backend/.env"), ...process.env };
const present = (name) => Boolean(backend[name]?.trim());
console.log("AfriMart setup check (configuration values are hidden)\n");

const requireBackend = createRequire(new URL("services/backend/package.json", root));
let PrismaClient;
try {
  ({ PrismaClient } = requireBackend("@prisma/client"));
  report("OK", "Dependencies", "Prisma client is available");
} catch {
  report("FAIL", "Dependencies", "run npm install, then npm run db:generate");
}

let databaseUrl;
try {
  databaseUrl = new URL(backend.DATABASE_URL ?? "");
  if (!["postgres:", "postgresql:"].includes(databaseUrl.protocol) || !databaseUrl.hostname || databaseUrl.pathname.length < 2) {
    throw new Error("invalid database URL");
  }
  report("OK", "DATABASE_URL", "set; PostgreSQL URL structure is valid");
} catch {
  databaseUrl = undefined;
  report("FAIL", "DATABASE_URL", "set a PostgreSQL connection URL in services/backend/.env or the environment");
}

for (const app of ["buyer", "merchant", "ops"]) {
  // Next.js gives process variables priority, followed by .env.development.local,
  // .env.local, .env.development and .env for a local development run.
  const env = {
    ...readEnv(`apps/${app}/.env`),
    ...readEnv(`apps/${app}/.env.development`),
    ...readEnv(`apps/${app}/.env.local`),
    ...readEnv(`apps/${app}/.env.development.local`),
    ...process.env,
  };
  try {
    const configured = env.NEXT_PUBLIC_API_URL;
    const url = new URL(configured ?? "http://localhost:4000/trpc");
    if (!["http:", "https:"].includes(url.protocol) || !url.pathname.endsWith("/trpc") || url.username || url.password) {
      throw new Error("invalid API URL");
    }
    report("OK", `${app} API URL`, configured ? "configured" : "using the localhost:4000/trpc default");
  } catch {
    report("FAIL", `${app} API URL`, "NEXT_PUBLIC_API_URL must be an HTTP(S) URL ending in /trpc, without credentials");
  }
}

console.log("\nExternal services (setting a key does not implement the integration):");
for (const name of [
  "STRIPE_SECRET_KEY", "STRIPE_WEBHOOK_SECRET", "EASYPOST_API_KEY",
  "TWILIO_ACCOUNT_SID", "TWILIO_AUTH_TOKEN", "TWILIO_MESSAGING_SERVICE_SID",
  "TWILIO_FROM_NUMBER", "ANTHROPIC_API_KEY", "VOYAGE_API_KEY",
  "S3_BUCKET", "S3_ACCESS_KEY_ID", "S3_SECRET_ACCESS_KEY", "S3_ENDPOINT", "S3_REGION",
  "PHOTO_URL_SECRET", "CORS_ORIGINS",
]) {
  report(present(name) ? "SET" : "UNSET", name, present(name) ? "value hidden; not authenticated" : "not configured");
}
if (backend.SMS_ENABLED === "yes") {
  const ready = present("TWILIO_ACCOUNT_SID") && present("TWILIO_AUTH_TOKEN") &&
    (present("TWILIO_MESSAGING_SERVICE_SID") || present("TWILIO_FROM_NUMBER"));
  report(ready ? "OK" : "FAIL", "SMS_ENABLED", ready ? "enabled; provider credentials still need validation" : "enabled without all required Twilio settings");
} else {
  report("INFO", "SMS_ENABLED", "real SMS is disabled; local development captures texts to files");
}

if (process.argv.includes("--database") && databaseUrl && PrismaClient) {
  // Explicit, read-only connectivity check; no migrations, seeds or remote API calls.
  databaseUrl.searchParams.set("connect_timeout", "5");
  databaseUrl.searchParams.set("pool_timeout", "5");
  let db;
  try {
    db = new PrismaClient({ datasources: { db: { url: databaseUrl.toString() } } });
    await db.$queryRaw`SELECT 1`;
    report("OK", "Database connection", "SELECT 1 succeeded; schema/migration status has not been checked");
  } catch {
    report("FAIL", "Database connection", "could not query PostgreSQL; check that it is running and the credentials are correct");
  } finally {
    await db?.$disconnect();
  }
} else if (!process.argv.includes("--database")) {
  report("INFO", "Database connection", "not tested; use npm run check:setup -- --database for a read-only connection check");
}

console.log("\nImplementation gaps at takeover:");
console.log("- Stripe: checkout, verified webhooks, Connect account onboarding, transfers and refunds remain to be wired.");
console.log("- EasyPost and Stripe Tax: checkout still uses local carrier quotes and estimated tax.");
console.log("- Seller onboarding: registration, shelf capture and catalogue review are implemented; live provider evaluation and website import remain.");
console.log("- Cook: scripted recipes; Anthropic/Voyage are not connected.");
console.log("- Email and web push: local/in-memory senders; real delivery remains to be implemented.");
console.log(`\n${failures ? `${failures} setup problem(s) found.` : "Basic configuration checks passed."} Provider integration and end-to-end flows are not checked.`);
console.log(`Project instructions: ${fileURLToPath(new URL("CLAUDE.md", root))}`);
process.exitCode = failures ? 1 : 0;
