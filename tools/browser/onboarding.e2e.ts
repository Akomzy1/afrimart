/** Real-browser onboarding against local apps. Run with backend .env loaded.
 * Uses the public dev staff credentials and synthetic phone numbers; SMS must
 * stay in the local file sender. Cleans up its stores, sessions and texts. */
import assert from "node:assert/strict";
import { randomInt } from "node:crypto";
import { readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { generateSync } from "otplib";
import { prisma } from "../../services/backend/src/db.js";
import { assertDevOnlyAllowed } from "../../services/backend/src/runtime.js";
import { DEV_STAFF_DOMAIN, DEV_STAFF_PASSWORD, DEV_STAFF_TOTP_SECRET } from "../../services/backend/src/auth/devStaff.js";
import { Browser } from "./cdp.js";

assertDevOnlyAllowed();
assert.notEqual(process.env.SMS_ENABLED, "yes", "This browser test requires the local file SMS sender.");
const base = randomInt(1_000_000, 8_000_000);
const phones = [`+1555${base}`, `+1555${base + 1}`];
const name = `Browser onboarding ${Date.now()}`;
const smsDir = path.resolve("services/backend/.sms");
const shotDir = path.resolve("tmp/onboarding-qa");
const MERCHANT = process.env.MERCHANT_URL ?? "http://localhost:3001";
const OPS = process.env.OPS_URL ?? "http://localhost:3002";
let browser: Browser | undefined;
const row = `([...document.querySelectorAll('.op-table tbody tr')].find(r => r.innerText.includes(${JSON.stringify(name)})))`;
const select = async (b: Browser, selector: string, value: string) => b.eval(`(() => { const el = document.querySelector(${JSON.stringify(selector)}); el.value = ${JSON.stringify(value)}; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);

async function smsCode(phone: string) {
  for (let attempt = 0; attempt < 40; attempt++) {
    const files = (await readdir(smsDir).catch(() => [] as string[])).filter((f) => f.endsWith(`_${phone.replace(/\D/g, "")}.txt`)).sort();
    if (files.length) return /\b(\d{6})\b/.exec(await readFile(path.join(smsDir, files.at(-1)!), "utf8"))![1]!;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error("The local sign-in text did not arrive.");
}

async function register(b: Browser, phone: string, storeName: string, inviteUrl?: string) {
  await b.send("Emulation.setDeviceMetricsOverride", { width: 390, height: 844, deviceScaleFactor: 2, mobile: true });
  await b.goto(inviteUrl ?? `${MERCHANT}/onboarding`);
  await b.waitFor(`document.querySelector('#si-phone')`, "seller phone form");
  await b.screenshot(path.join(shotDir, "01-welcome.png"));
  await b.type("#si-phone", phone);
  await b.click("Send my code");
  await b.waitFor(`document.querySelector('.mr-otp input')`, "six-digit code form");
  assert.equal(await b.eval(`document.querySelectorAll('.mr-otp input').length`), 6);
  const code = await smsCode(phone);
  await b.type(".mr-otp input", code === "000000" ? "111111" : "000000");
  await b.waitFor(`document.querySelector('[role=alert]')`, "invalid code feedback");
  await b.type(".mr-otp input", code);
  await b.waitFor(`document.querySelector('#onb-name')`, "real store details");
  await b.type("#onb-name", storeName);
  await b.type("#onb-owner", "Browser Tester");
  await select(b, "#onb-type", "home_seller");
  await b.eval(`document.querySelector('input[type=checkbox]').click()`);
  assert.equal(await b.overflow(), 0);
  await b.screenshot(path.join(shotDir, "02-profile.png"));
  await b.click("Save my details");
  await b.waitFor(`document.body.innerText.includes('How would you like to start?')`, "catalogue preference");
  await b.click("Connect your website");
  await b.type("#onb-site", "https://example.test/store");
  await b.screenshot(path.join(shotDir, "03-preference.png"));
  await b.click("Save and continue");
  await b.waitFor(`document.body.innerText.includes('Your store is registered.')`, "saved registration");
  assert.ok((await b.text()).includes("Your store is not public yet"));
  assert.equal(await b.overflow(), 0);
  await b.screenshot(path.join(shotDir, "04-registered.png"));
  await b.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 2, mobile: true });
  assert.equal(await b.overflow(), 0);
  await b.screenshot(path.join(shotDir, "05-registered-320.png"));
  await b.goto(`${MERCHANT}/onboarding`);
  await b.waitFor(`document.body.innerText.includes('Your store is registered.')`, "registration after reload");
  assert.equal(await b.eval(`document.querySelector('.mr-kit .kh')?.textContent`), storeName);
  await b.click("Go to my store");
  await b.waitFor(`location.pathname === '/' && document.body.innerText.includes('Orders')`, "merchant app after onboarding");
  console.log(`PASS ${inviteUrl ? "assisted" : "self-service"} registration, validation, reload and 320/390px layouts`);
}

try {
  assert.equal(await prisma.store.count({ where: { ownerPhone: { in: phones } } }), 0);
  const b = browser = await Browser.launch({ width: 1440, height: 1000 });
  await b.goto(OPS);
  await b.waitFor(`document.querySelector('#em')`, "staff sign-in", 120_000);
  await b.type("#em", `admin@${DEV_STAFF_DOMAIN}`);
  await b.type("#pw", DEV_STAFF_PASSWORD);
  await b.click("Continue");
  await b.waitFor(`document.querySelector('#cd')`, "staff MFA");
  if (30 - (Math.floor(Date.now() / 1000) % 30) < 5) await new Promise((r) => setTimeout(r, 5000));
  await b.type("#cd", generateSync({ secret: DEV_STAFF_TOTP_SECRET }));
  await b.click("Sign in");
  await b.waitFor(`document.querySelector('.op-tabs button')`, "staff console");
  console.log("Staff sign-in complete; opening onboarding.");
  await b.click("Onboarding");
  await b.waitFor(`[...document.querySelectorAll('button')].some(b => b.innerText === 'Create store')`, "store list and create action");
  await b.click("Create store");
  await b.type("#new-store-name", name);
  await b.type("#new-store-owner", "Browser Tester");
  await b.type("#new-store-phone", phones[0]!);
  await b.waitFor(`document.querySelectorAll('#new-store-hub option').length > 1`, "supply hubs");
  const hub = await b.eval<string>(`document.querySelectorAll('#new-store-hub option')[1].value`);
  await select(b, "#new-store-hub", hub);
  await b.click("Save store");
  await b.waitFor(`${row} || document.querySelector('[role=alert]')`, "store creation result");
  assert.ok(await b.eval(`!!${row}`), (await b.text()).slice(0, 1600));
  console.log("Pending store created through the operations form.");
  await b.click("Issue invitation", "button", row);
  await b.waitFor(`${row}?.querySelector('input[readonly]')`, "invitation link");
  const invitation = await b.eval<string>(`${row}.querySelector('input[readonly]').value`);
  assert.ok(invitation.startsWith(`${MERCHANT}/onboarding#invite=`));
  await register(b, phones[0]!, name, invitation);
  const assisted = await prisma.store.findUniqueOrThrow({ where: { ownerPhone: phones[0]! } });
  assert.ok(assisted.ownerPhoneVerifiedAt);
  assert.equal(assisted.onboardingStatus, "filming");
  assert.equal(assisted.verificationStatus, "unverified");
  assert.ok((await prisma.onboardingInvite.findFirstOrThrow({ where: { storeId: assisted.id } })).consumedAt);

  await b.send("Emulation.setDeviceMetricsOverride", { width: 1440, height: 1000, deviceScaleFactor: 1, mobile: false });
  await b.goto(OPS);
  await b.waitFor(`document.querySelector('.op-tabs button')`, "staff console again");
  await b.click("Onboarding");
  await b.waitFor(`${row}?.innerText.includes('Phone verified')`, "verified phone in ops");
  await b.click("Record kit", "button", row);
  await b.type("input[id^=packaging-]", "12 boxes and tape", row);
  await b.type("input[id^=printer-]", "ONB-BROWSER-001", row);
  await b.click("Save kit record", "button", row);
  await b.waitFor(`${row}?.innerText.includes('Kit: 12 boxes')`, "persisted kit record");
  await b.eval(`(() => { const el = [...${row}.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'verified')); el.value='verified'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await b.waitFor(`${row} && [...${row}.querySelectorAll('select')].some(s => s.value === 'verified') && !${row}.querySelector('select:disabled')`, "approval saved");
  await b.eval(`(() => { const el = [...${row}.querySelectorAll('select')].find(s => [...s.options].some(o => o.value === 'live')); el.value='live'; el.dispatchEvent(new Event('change', {bubbles:true})); })()`);
  await b.waitFor(`${row}?.querySelector('[role=alert]')`, "go-live refused without catalogue");
  assert.ok((await b.text()).includes("approve their catalogue"));
  assert.equal(await b.overflow(), 0);
  await b.screenshot(path.join(shotDir, "06-ops.png"));
  console.log("PASS staff creation, invitation, phone status, kit recording, approval and go-live validation");

  await b.send("Network.clearBrowserCookies");
  await register(b, phones[1]!, `${name} self-service`);
  assert.equal(await prisma.store.count({ where: { ownerPhone: phones[1]! } }), 1);
  assert.equal(b.consoleErrors.filter((e) => e.startsWith("EXC ")).length, 0, b.consoleErrors.join("\n"));
  console.log(`PASS browser flows; screenshots in ${shotDir}`);
} finally {
  await browser?.close();
  const stores = await prisma.store.findMany({ where: { ownerPhone: { in: phones } }, select: { id: true } });
  const ids = stores.map((s) => s.id);
  await prisma.userSession.deleteMany({ where: { storeId: { in: ids } } });
  await prisma.store.deleteMany({ where: { id: { in: ids } } });
  await prisma.authCode.deleteMany({ where: { identifier: { in: phones } } });
  for (const file of await readdir(smsDir).catch(() => [] as string[])) {
    if (phones.some((p) => file.endsWith(`_${p.replace(/\D/g, "")}.txt`))) await unlink(path.join(smsDir, file));
  }
  await prisma.$disconnect();
}
