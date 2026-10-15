/**
 * A small headless-Chrome driver over the DevTools Protocol, for checking the
 * apps in a real browser: read computed layout, click through a flow, take a
 * picture under the same emulation the numbers were measured in (CLAUDE.md,
 * "Verifying UI work"). No browser-automation package: Chrome itself, Node's
 * global WebSocket and fetch.
 *
 * Each run uses its own throwaway profile and port, and removes both, so a run
 * that crashed cannot leave a profile locked for the next one.
 */
import { spawn, execFileSync, type ChildProcess } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

const CHROME_CANDIDATES = [
  process.env.CHROME_PATH,
  "C:/Program Files/Google/Chrome/Application/chrome.exe",
  "C:/Program Files (x86)/Google/Chrome/Application/chrome.exe",
  "/usr/bin/google-chrome",
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
].filter((p): p is string => Boolean(p));

export interface Viewport {
  width: number;
  height: number;
  mobile?: boolean;
}

export class Browser {
  private ws!: WebSocket;
  private nextId = 0;
  private pending = new Map<number, (m: { result?: Record<string, unknown>; error?: unknown }) => void>();
  readonly consoleErrors: string[] = [];
  private chrome!: ChildProcess;
  private profile = "";

  static async launch(view: Viewport, opts: { fakeCamera?: boolean } = {}): Promise<Browser> {
    const exe = CHROME_CANDIDATES.find((p) => existsSync(p));
    if (!exe) throw new Error("Chrome was not found. Set CHROME_PATH to its executable.");
    const b = new Browser();
    const port = 9500 + Math.floor(Math.random() * 400);
    b.profile = mkdtempSync(path.join(tmpdir(), "afrimart-chrome-"));
    b.chrome = spawn(
      exe,
      [
        "--headless=new",
        `--remote-debugging-port=${port}`,
        `--user-data-dir=${b.profile}`,
        "--no-first-run",
        "--disable-gpu",
        ...(opts.fakeCamera ? ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"] : []),
        "about:blank",
      ],
      { stdio: "ignore" },
    );
    let targets: { type: string; webSocketDebuggerUrl: string }[] = [];
    for (let i = 0; i < 80 && !targets.length; i++) {
      try {
        targets = (await (await fetch(`http://127.0.0.1:${port}/json`)).json()) as typeof targets;
      } catch {
        await sleep(500);
      }
    }
    const page = targets.find((t) => t.type === "page");
    if (!page) throw new Error("Chrome started but offered no page to drive.");
    b.ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise<void>((r) => (b.ws.onopen = () => r()));
    b.ws.onmessage = (m) => {
      const d = JSON.parse(String(m.data));
      if (d.id && b.pending.has(d.id)) {
        b.pending.get(d.id)!(d);
        b.pending.delete(d.id);
      }
      if (d.method === "Runtime.consoleAPICalled" && d.params.type === "error") {
        b.consoleErrors.push(d.params.args.map((a: { value?: string; description?: string }) => a.value ?? a.description).join(" "));
      }
      if (d.method === "Runtime.exceptionThrown") {
        b.consoleErrors.push(`EXC ${d.params.exceptionDetails.exception?.description ?? d.params.exceptionDetails.text}`);
      }
    };
    await b.send("Runtime.enable");
    await b.send("Page.enable");
    await b.send("Emulation.setDeviceMetricsOverride", { width: view.width, height: view.height, deviceScaleFactor: 2, mobile: view.mobile ?? false });
    return b;
  }

  send(method: string, params: Record<string, unknown> = {}) {
    return new Promise<{ result?: Record<string, unknown>; error?: unknown }>((resolve) => {
      const id = ++this.nextId;
      this.pending.set(id, resolve);
      this.ws.send(JSON.stringify({ id, method, params }));
    });
  }

  /** Evaluate an expression in the page and return its value (awaits promises). */
  async eval<T = unknown>(expression: string): Promise<T> {
    const r = await this.send("Runtime.evaluate", { expression, returnByValue: true, awaitPromise: true });
    if (!r.result) throw new Error(`CDP error: ${JSON.stringify(r.error)} for ${expression.slice(0, 160)}`);
    const res = r.result as { exceptionDetails?: { text?: string; exception?: { description?: string } }; result?: { value?: T } };
    if (res.exceptionDetails) throw new Error(res.exceptionDetails.exception?.description ?? res.exceptionDetails.text ?? "page error");
    return res.result?.value as T;
  }

  async goto(url: string) {
    await this.send("Page.navigate", { url });
    await sleep(1200);
  }

  text(): Promise<string> {
    return this.eval<string>("document.body ? document.body.innerText : ''");
  }

  /** Horizontal overflow against the viewport (not the body), as CLAUDE.md asks. */
  overflow(): Promise<number> {
    return this.eval<number>("document.documentElement.scrollWidth - window.innerWidth");
  }

  async waitFor(predicate: string, label: string, ms = 60_000) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
      try {
        if (await this.eval<boolean>(`!!(${predicate})`)) return;
      } catch {
        /* the page may be mid-navigation */
      }
      await sleep(250);
    }
    let seen = "";
    try {
      seen = (await this.text()).replace(/\s+/g, " ").slice(0, 400);
    } catch {
      /* ignore */
    }
    throw new Error(`Timed out waiting for ${label}. The page said: ${seen}`);
  }

  /** Click the first visible element in `scope` (a CSS selector, default the page) whose text or aria-label contains `needle`. */
  async click(needle: string, selector = "button, a, [role=button], [role=menuitem]", scope = "document") {
    const ok = await this.eval<boolean>(`(() => {
      const root = ${scope};
      if (!root) return false;
      const el = [...root.querySelectorAll(${JSON.stringify(selector)})].find((e) => (e.innerText + " " + (e.getAttribute("aria-label") ?? "")).replace(/\\s+/g, " ").includes(${JSON.stringify(needle)}));
      if (!el) return false; el.click(); return true; })()`);
    if (!ok) throw new Error(`No "${needle}" to click (${selector}).`);
    await sleep(350);
  }

  /** Set a React-controlled input's value the way typing does. */
  async type(selector: string, value: string, scope = "document") {
    const ok = await this.eval<boolean>(`(() => {
      const el = (${scope}).querySelector(${JSON.stringify(selector)});
      if (!el) return false;
      const proto = el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
      Object.getOwnPropertyDescriptor(proto, "value").set.call(el, ${JSON.stringify(value)});
      el.dispatchEvent(new Event("input", { bubbles: true })); return true; })()`);
    if (!ok) throw new Error(`No input matching ${selector}.`);
    await sleep(150);
  }

  async screenshot(file: string) {
    mkdirSync(path.dirname(file), { recursive: true });
    const r = await this.send("Page.captureScreenshot", { format: "png" });
    writeFileSync(file, Buffer.from((r.result as { data: string }).data, "base64"));
  }

  async close() {
    try {
      this.ws.close();
    } catch {
      /* already closed */
    }
    try {
      if (process.platform === "win32" && this.chrome.pid) execFileSync("taskkill", ["/PID", String(this.chrome.pid), "/T", "/F"], { stdio: "ignore" });
      else this.chrome.kill("SIGKILL");
    } catch {
      /* already gone */
    }
    await sleep(500);
    try {
      rmSync(this.profile, { recursive: true, force: true, maxRetries: 3 });
    } catch {
      /* a profile left in the temp folder is harmless */
    }
  }
}

/** A tiny check runner that prints like the verify scripts and exits non-zero on any failure. */
export function checker() {
  let failures = 0;
  return {
    check(label: string, pass: boolean, detail = "") {
      if (!pass) failures++;
      console.log(`${pass ? "  ok  " : "  FAIL"}  ${label}${detail ? `  — ${detail}` : ""}`);
    },
    get failures() {
      return failures;
    },
  };
}
