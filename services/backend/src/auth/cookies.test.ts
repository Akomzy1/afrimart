import { test, describe } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import { clearSessionCookie, cookieName, cookieSameSite, cookieSecure, parseCookies, sessionCookie, setSessionCookie } from "./cookies.js";
import { allowedOriginList, corsOrigins, isAllowedOrigin } from "./origins.js";

const src = (rel: string) => readFile(new URL(rel, import.meta.url), "utf8");
const dev = { NODE_ENV: "development", DATABASE_URL: "postgresql://postgres:postgres@localhost:5432/afrimart" } as NodeJS.ProcessEnv;
const prod = { NODE_ENV: "production", DATABASE_URL: "postgresql://u:p@db.example.com:5432/afrimart" } as NodeJS.ProcessEnv;
const token = "A".repeat(43);
const expires = new Date(Date.now() + 90 * 86_400_000);

describe("the session cookie in production", () => {
  const set = setSessionCookie("buyer", token, expires, prod);

  test("httpOnly, Secure, SameSite=Strict, whole-site path, no Domain", () => {
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/"]) assert.ok(set.split("; ").includes(attr), `missing ${attr}: ${set}`);
    assert.ok(!/Domain=/i.test(set), "a Domain would let sibling subdomains read or overwrite it");
  });

  test("the __Host- prefix, which makes a browser refuse a cookie of that name set any other way", () => {
    assert.ok(set.startsWith(`__Host-afrimart_buyer=${token};`), set);
    assert.equal(cookieName("store", prod), "__Host-afrimart_store");
  });

  test("it lives as long as the session and no longer", () => {
    const maxAge = Number(/Max-Age=(\d+)/.exec(set)![1]);
    assert.ok(Math.abs(maxAge - 90 * 86_400) < 5);
    assert.ok(set.includes(`Expires=${expires.toUTCString()}`));
  });

  test("clearing it uses the same attributes, which is what makes a browser accept the removal", () => {
    const clear = clearSessionCookie("buyer", prod);
    assert.ok(clear.startsWith("__Host-afrimart_buyer=;"));
    for (const attr of ["HttpOnly", "Secure", "SameSite=Strict", "Path=/", "Max-Age=0"]) assert.ok(clear.split("; ").includes(attr), `missing ${attr}: ${clear}`);
  });
});

describe("the session cookie on a development machine", () => {
  test("over plain http: not Secure and no prefix (the prefix needs Secure), still httpOnly and SameSite", () => {
    assert.equal(cookieSecure(dev), false);
    const set = setSessionCookie("store", token, expires, dev);
    assert.ok(set.startsWith(`afrimart_store=${token};`));
    assert.ok(!set.includes("Secure") && set.includes("HttpOnly") && set.includes("SameSite=Strict"));
  });
});

describe("SameSite", () => {
  test("Strict unless told otherwise; Lax and None only by name", () => {
    assert.equal(cookieSameSite(prod), "Strict");
    assert.equal(cookieSameSite({ ...prod, SESSION_COOKIE_SAMESITE: "lax" }), "Lax");
    assert.equal(cookieSameSite({ ...prod, SESSION_COOKIE_SAMESITE: "None" }), "None");
    assert.equal(cookieSameSite({ ...prod, SESSION_COOKIE_SAMESITE: "anything" }), "Strict", "an unknown value falls back to the safest");
  });

  test("None is refused without Secure, since a browser would drop it", () => {
    assert.throws(() => cookieSameSite({ ...dev, SESSION_COOKIE_SAMESITE: "none" }), /needs a Secure cookie/);
  });
});

describe("reading cookies", () => {
  test("a header becomes pairs, and the first of a repeated name wins", () => {
    assert.deepEqual(parseCookies("a=1; b=2; a=3"), { a: "1", b: "2" });
    assert.deepEqual(parseCookies(undefined), {});
    assert.deepEqual(parseCookies("=x; noequals; ; ok=1"), { ok: "1" });
  });

  test("a buyer's session is read only from the buyer cookie, and a shop's only from the shop's", () => {
    const header = `afrimart_buyer=${token}; afrimart_store=${"B".repeat(43)}`;
    assert.equal(sessionCookie(header, "buyer", dev), token);
    assert.equal(sessionCookie(header, "store", dev), "B".repeat(43));
    assert.equal(sessionCookie(`afrimart_store=${token}`, "buyer", dev), null);
  });

  test("anything that could not be a token is not looked up", () => {
    for (const bad of ["", "short", "a b c d e f g h i j k l m n o p", "x".repeat(300), "<script>alert(1)</script>"]) {
      assert.equal(sessionCookie(`afrimart_buyer=${bad}`, "buyer", dev), null, bad);
    }
  });

  test("in production the unprefixed name is not accepted, so a cookie set by a sibling site cannot stand in", () => {
    assert.equal(sessionCookie(`afrimart_buyer=${token}`, "buyer", prod), null);
    assert.equal(sessionCookie(`__Host-afrimart_buyer=${token}`, "buyer", prod), token);
  });
});

describe("which origins may use a cookie", () => {
  test("localhost on any port is always allowed; nothing else is, unless it is named", () => {
    assert.equal(isAllowedOrigin("http://localhost:3000", {} as NodeJS.ProcessEnv), true);
    assert.equal(isAllowedOrigin("http://localhost:3001", {} as NodeJS.ProcessEnv), true);
    for (const o of ["https://localhost:3000", "http://localhost", "http://evil.localhost:3000", "http://localhost:3000.evil.example", "https://afrimart.com", "null", "", undefined]) {
      assert.equal(isAllowedOrigin(o as string | undefined, {} as NodeJS.ProcessEnv), false, String(o));
    }
  });

  test("deployed origins come from CORS_ORIGINS, exactly: no wildcards, no subdomain guessing", () => {
    const env = { CORS_ORIGINS: "https://app.afrimart.com, https://sell.afrimart.com/" } as NodeJS.ProcessEnv;
    assert.deepEqual(allowedOriginList(env), ["https://app.afrimart.com", "https://sell.afrimart.com"]);
    assert.equal(isAllowedOrigin("https://app.afrimart.com", env), true);
    assert.equal(isAllowedOrigin("https://sell.afrimart.com", env), true);
    for (const o of ["https://afrimart.com", "https://evil.afrimart.com", "https://app.afrimart.com.evil.example", "http://app.afrimart.com"]) {
      assert.equal(isAllowedOrigin(o, env), false, o);
    }
    assert.equal(corsOrigins(env).length, 3);
  });

  test("a header that arrives as a list is not an origin", () => {
    assert.equal(isAllowedOrigin(["http://localhost:3000"] as unknown as string, {} as NodeJS.ProcessEnv), false);
  });
});

describe("how it is wired", () => {
  test("tokens are never put in a response body: the verify routes return the expiry and nothing else", async () => {
    const text = await src("../routers/userAuth.ts");
    assert.ok(!/return \{ token/.test(text) && !/token: session\.token/.test(text));
    assert.match(text, /sendCookie\(ctx, setSessionCookie\(/);
  });

  test("a write only honours a cookie from an allowed origin", async () => {
    const text = await src("../trpc.ts");
    assert.match(text, /safeMethod \|\| isAllowedOrigin\(req\.headers\.origin\)/);
  });

  test("CORS is built from the same origin list the write check uses", async () => {
    const app = await src("../app.ts");
    assert.match(app, /origin: corsOrigins\(\)/);
    assert.match(app, /credentials: true/);
  });
});
