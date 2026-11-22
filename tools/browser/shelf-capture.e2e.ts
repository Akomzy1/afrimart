/** Exercise the merchant UI with a deterministic camera stream and real local storage. */
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import path from "node:path";
import sharp from "sharp";
import { Browser } from "./cdp.js";
import { prisma } from "../../services/backend/src/db.js";
import { issueUserSession } from "../../services/backend/src/auth/userSession.js";
import { assertDevOnlyAllowed } from "../../services/backend/src/runtime.js";
import { cleanShelfUploads } from "../../services/backend/src/routers/shelfCapture.js";
import { callerFor } from "../../services/backend/src/scripts/callers.js";
import { photoStore } from "../../services/backend/src/storage/store.js";

assertDevOnlyAllowed();
const origin = process.env.MERCHANT_URL ?? "http://localhost:3001";
const shot = (name: string) => path.resolve("tmp/onboarding-qa", name + ".png");
const hub = await prisma.hubMetro.findFirstOrThrow({ where: { active: true } });
const store = await prisma.store.create({ data: {
  name: "Shelf camera walkthrough", ownerName: "Camera tester", sellerType: "store", hubMetroId: hub.id,
  ownerPhoneVerifiedAt: new Date(), onboardingProfileAt: new Date(), foodSafetyAttestedAt: new Date(),
  onboardingStatus: "filming", onboardingRail: "film",
} });
let browser: Browser | undefined;
const fixture = `let testScene = "dark";
Object.defineProperty(navigator.mediaDevices, "getUserMedia", {value: async () => {
  if (testScene === "denied") throw new DOMException("Camera denied", "NotAllowedError");
  const canvas = document.createElement("canvas");
  canvas.width = 800; canvas.height = 600;
  const ctx = canvas.getContext("2d");
  function draw() {
    ctx.fillStyle = testScene === "dark" ? "#101010" : "#ceb996";
    ctx.fillRect(0, 0, 800, 600);
    if (testScene === "dark") return;
    if (testScene === "glare" || testScene === "blur" || testScene === "far") {
      ctx.fillStyle = testScene === "glare" ? "#ffffff" : "#aaaaaa";
      ctx.fillRect(0, 0, 800, 600);
      if (testScene === "far") {
        for (let i = 0; i < 6; i++) {
          ctx.fillStyle = i%2 ? "#eeeeee" : "#101010";
          ctx.fillRect(385+i*5, 282, 5, 36);
        }
      }
      return;
    }
    for (let y = 0; y < 5; y++) for (let x = 0; x < 8; x++) {
      ctx.fillStyle = (x+y)%2 ? "#294332" : "#945025";
      ctx.fillRect(x*100, y*120, 85, 72);
      ctx.fillStyle = "#201c16";
      ctx.font = "bold 20px sans-serif";
      ctx.fillText("Rice 4.50", x*100, y*120+94);
    }
  }
  draw();
  const stream = canvas.captureStream(8);
  const timer = setInterval(() => {
    if (stream.getVideoTracks()[0].readyState === "ended") clearInterval(timer);
    else draw();
  }, 125);
  return stream;
}});`;

try {
  const session = await issueUserSession({ kind: "store", storeId: store.id }, {});
  const api = callerFor({ identity: "store:" + store.id }).shelfCapture;
  const b = browser = await Browser.launch({ width: 390, height: 844, mobile: true });
  await b.send("Network.setCookie", { name: "afrimart_store", value: session.token, url: origin, httpOnly: true });
  await b.send("Page.addScriptToEvaluateOnNewDocument", { source: fixture });
  await b.goto(origin + "/onboarding");
  await b.waitFor("document.body.innerText.includes('Open shelf filming')", "onboarding capture entry", 120_000);
  await b.click("Open shelf filming");
  const button = (label: string) => `Array.from(document.querySelectorAll("button")).some(el => el.innerText === ${JSON.stringify(label)})`;
  await b.waitFor(button("Film shelf 1"), "first shelf", 120_000);
  await b.click("Film shelf 1");
  await b.waitFor("document.body.innerText.includes('Find a little more light')", "poor frame coaching");
  assert.equal(await b.eval("document.querySelector('.mr-actionbar button').disabled"), true);
  for (const [scene, message] of [["glare", "Tilt the phone a little"], ["blur", "Hold still a moment"], ["far", "Come a little closer"]]) {
    await b.eval(`testScene = ${JSON.stringify(scene)}`);
    await b.waitFor(`document.body.innerText.includes(${JSON.stringify(message)})`, scene + " coaching");
    assert.equal(await b.eval("document.querySelector('.mr-actionbar button').disabled"), true);
  }
  await b.eval('testScene = "clear"');
  await b.waitFor("document.querySelector('.mr-pill.saved b')?.textContent === '1'", "clear frame retained");
  await b.screenshot(shot("07-shelf-camera"));
  assert.equal(await b.overflow(), 0);
  await b.click("Save shelf");
  await b.waitFor(button("Film shelf 2"), "first shelf committed");
  const first = await prisma.shelfFrame.findFirstOrThrow({ where: { session: { storeId: store.id } } });
  const original = await photoStore.read("shelf", first.name);
  assert.ok(original);
  assert.equal((await sharp(original).metadata()).format, "jpeg");
  const before = await api.session();
  const frame = original.toString("base64");
  await api.saveShelf({ revision: 0, shelf: 1, passId: first.passId, frames: [frame] });
  assert.equal((await api.session()).revision, before.revision);
  await assert.rejects(api.saveShelf({ revision: before.revision, shelf: 1, passId: randomUUID(), frames: [frame, "AAAA"] }));
  assert.equal((await api.session()).revision, before.revision);
  await b.goto(origin + "/onboarding/shelves");
  await b.waitFor(button("Re-film"), "saved shelf after reload");
  await b.click("Re-film shelf 1");
  await b.waitFor("document.body.innerText.includes('Find a little more light')", "re-film starts clean");
  await b.eval('testScene = "clear"');
  await b.waitFor("document.querySelector('.mr-pill.saved b')?.textContent === '1'", "replacement frame");
  await b.click("Save shelf");
  await b.waitFor(button("Film shelf 2"), "replacement saved");
  assert.equal((await api.session()).shelves[0].count, 1);
  assert.equal(await photoStore.read("shelf", first.name), null);
  await b.eval('testScene = "denied"');
  await b.click("Film shelf 2");
  await b.waitFor("document.body.innerText.includes('Allow camera access')", "camera permission fallback");
  await b.eval(`(async () => {
    const photo = await (await fetch("data:image/jpeg;base64," + ${JSON.stringify(frame)})).blob();
    const transfer = new DataTransfer();
    transfer.items.add(new File([photo], "shelf.jpg", {type: "image/jpeg"}));
    const input = document.querySelector('input[type=file]');
    input.files = transfer.files;
    input.dispatchEvent(new Event("change", {bubbles: true}));
  })()`);
  await b.waitFor("document.querySelector('.mr-pill.saved b')?.textContent === '1'", "next shelf frame");
  await b.click("Save shelf");
  await b.waitFor(button("Film shelf 3"), "two shelves saved");
  await b.send("Emulation.setDeviceMetricsOverride", { width: 320, height: 740, deviceScaleFactor: 2, mobile: true });
  assert.equal(await b.overflow(), 0);
  const current = await api.session();
  await assert.rejects(api.saveShelf({ revision: current.revision, shelf: 3, passId: randomUUID(), frames: Array(59).fill(frame) }), { code: "BAD_REQUEST" });
  const concurrent = await Promise.allSettled([randomUUID(), randomUUID()].map(passId => api.saveShelf({
    revision: current.revision, shelf: 1, passId, frames: [frame],
  })));
  assert.equal(concurrent.filter(r => r.status === "fulfilled").length, 1);
  assert.equal(concurrent.filter(r => r.status === "rejected" && r.reason.code === "CONFLICT").length, 1);
  await b.goto(origin + "/onboarding/shelves");
  await b.waitFor(button("Done filming"), "latest saved shelves");
  await b.click("Done filming");
  await b.waitFor("document.body.innerText.includes('Your shelf photos are saved.')", "capture completion");
  await b.screenshot(shot("08-shelves-saved"));
  assert.equal(await b.overflow(), 0);
  assert.deepEqual((await api.session()).shelves.map(s => s.count), [1,1]);
  assert.ok((await api.session()).finished);
  await assert.rejects(api.saveShelf({ revision: 0, shelf: 1, passId: randomUUID(), frames: [frame] }), { code: "CONFLICT" });
  assert.equal(await prisma.catalogueDraft.count({ where: { storeId: store.id } }), 0);
  assert.equal(b.consoleErrors.filter(s => s.startsWith("EXC ")).length, 0);
  console.log("PASS guided capture, dark, glare, blur and distance guidance, private JPEGs, retry, failed replacement, re-film, reload, camera-denied file selection, concurrent saves, frame limit, completion and mobile layouts.");
} finally {
  await browser?.close();
  await prisma.userSession.deleteMany({ where: { storeId: store.id } });
  await prisma.store.delete({ where: { id: store.id } });
  await cleanShelfUploads();
  await prisma.$disconnect();
}
