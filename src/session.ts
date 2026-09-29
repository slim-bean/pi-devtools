/**
 * One live connection to a user-launched Chrome over CDP, and the single tab
 * the agent drives across tool calls.
 *
 * Design:
 *  - Attach by default; optional managed auto-launch uses a dedicated profile.
 *    Chrome can also be started explicitly with --remote-debugging-port. The human
 *    can log in and click around in the same window the agent uses.
 *  - One persistent Page. SPA routes, form input and auth survive between
 *    tool calls; that is the whole point versus a one-shot fetch.
 *  - Console and network events are buffered for the current page and read by
 *    browser_console / browser_network, so "what broke since I clicked" is
 *    answerable. Switching tabs resets the buffers.
 *  - Lazy and self-healing: connect on first use, reconnect if Chrome
 *    restarts. Report lost state rather than replaying actions on a fresh tab.
 */
import {
  chromium,
  type Browser,
  type BrowserContext,
  type ConsoleMessage,
  type Page,
  type Request,
  type Response,
} from "playwright-core";

import { cdpUrl, cdpHeaders } from "./config";
import { ensureChrome } from "./launch";
export { cdpUrl, DEFAULT_CDP_URL } from "./config";
const CONNECT_TIMEOUT_MS = 5_000;
const CONSOLE_CAP = 500;
const NETWORK_CAP = 1_000;
const BODY_CAP = 2_048;

/** Resource types whose failure bodies are worth capturing for the model. */
const BODY_TYPES = new Set(["xhr", "fetch", "document"]);

export interface ConsoleEntry {
  ts: number;
  /** Playwright console type (log, info, warning, error, debug, …) or "pageerror". */
  level: string;
  text: string;
  /** "url:line:col" when the browser reported one. */
  location?: string;
}

export interface NetworkEntry {
  ts: number;
  method: string;
  url: string;
  resourceType: string;
  status?: number;
  /** Set when the request never got a response (DNS, refused, aborted, CORS…). */
  failure?: string;
  durationMs?: number;
  requestBody?: string;
  responseBody?: string;
  done: boolean;
}

export function isFailure(e: NetworkEntry): boolean {
  return e.failure !== undefined || (e.status !== undefined && e.status >= 400);
}

export class DevtoolsSession {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private consoleBuf: ConsoleEntry[] = [];
  private networkBuf: NetworkEntry[] = [];
  private inflight = new Map<Request, NetworkEntry>();
  private detachPage: (() => void) | null = null;
  private pageLost = false;
  private epoch = 0;
  private connecting: Promise<Browser> | null = null;
  private pageIds = new WeakMap<Page, string>();

  // ---- connection -------------------------------------------------------

  async connect(): Promise<Browser> {
    if (this.browser?.isConnected()) return this.browser;
    if (!this.connecting) this.connecting = this.connectOnce().finally(() => { this.connecting = null; });
    return this.connecting;
  }

  private async connectOnce(): Promise<Browser> {
    this.reset();
    const epoch = this.epoch;
    const url = cdpUrl();
    await ensureChrome();
    let browser: Browser;
    try {
      browser = await chromium.connectOverCDP(url, { timeout: CONNECT_TIMEOUT_MS, headers: cdpHeaders() });
    } catch (e) {
      throw new Error(
        `Cannot reach Chrome DevTools at ${url} (${(e as Error).message.split("\n")[0]}). ` +
          `Start Chrome with remote debugging (run /devtools launch, or scripts/chrome-launch.sh), ` +
          `or point PI_DEVTOOLS_CDP_URL at an existing one.`,
      );
    }
    if (epoch !== this.epoch) {
      await browser.close().catch(() => {});
      throw new Error("Browser connection cancelled: the pi session disconnected while Chrome was starting.");
    }
    browser.once("disconnected", () => {
      if (this.browser === browser) this.reset();
    });
    this.browser = browser;
    return browser;
  }

  isConnected(): boolean {
    return this.browser?.isConnected() ?? false;
  }

  /** Disconnect from Chrome. Chrome itself keeps running. */
  async close(): Promise<void> {
    this.epoch++;
    const b = this.browser;
    this.reset();
    if (b?.isConnected()) await b.close().catch(() => {});
    this.pageLost = false;
  }

  private reset(): void {
    if (this.page) this.pageLost = true;
    this.detachPage?.();
    this.detachPage = null;
    this.page = null;
    this.browser = null;
    this.consoleBuf = [];
    this.networkBuf = [];
    this.inflight.clear();
  }

  private context(browser: Browser): Promise<BrowserContext> {
    // Never silently create an incognito context with a different login identity.
    const existing = browser.contexts()[0];
    if (!existing) throw new Error("Chrome's default profile context is unavailable. Reconnect to a headed Chrome.");
    return Promise.resolve(existing);
  }

  // ---- pages ------------------------------------------------------------

  /** Allocate our own tab; a blank tab may belong to another agent or a fetch worker. */
  async getPage(allowReset = false): Promise<Page> {
    await this.connect();
    if (this.page && !this.page.isClosed()) return this.page;
    if (this.pageLost && !allowReset) {
      throw new Error("Browser state reset: your previous tab was closed or Chrome restarted. " +
        "Use browser_navigate to recreate the page, or browser_tabs to select an existing tab. " +
        "Inspect the current state before retrying any action; do not replay a send/submit blindly.");
    }
    return this.newPage();
  }

  /** CDP target ids stay stable while Chrome runs, unlike list indices. Not persisted. */
  async pageId(page: Page): Promise<string> {
    const known = this.pageIds.get(page);
    if (known) return known;
    const cdp = await page.context().newCDPSession(page);
    try {
      const { targetInfo } = await cdp.send("Target.getTargetInfo");
      this.pageIds.set(page, targetInfo.targetId);
      return targetInfo.targetId;
    } finally { await cdp.detach(); }
  }

  /** All open tabs in Chrome's default context. */
  async listPages(): Promise<Page[]> {
    const browser = await this.connect();
    const ctx = await this.context(browser);
    return ctx.pages().filter((p) => !p.isClosed());
  }

  async newPage(): Promise<Page> {
    const browser = await this.connect();
    const ctx = await this.context(browser);
    // Playwright's newPage omits CDP background, which activates Chrome. Create
    // the target explicitly so background work never takes the user's keyboard.
    const cdp = await browser.newBrowserCDPSession();
    let targetId: string;
    try {
      const firstWindow = process.env.PI_DEVTOOLS_BACKGROUND === "1" && ctx.pages().length === 0;
      ({ targetId } = await cdp.send("Target.createTarget", {
        url: "about:blank", background: true,
        ...(firstWindow ? { newWindow: true, windowState: "minimized" as const } : {}),
      }));
    }
    finally { await cdp.detach(); }
    const until = Date.now() + CONNECT_TIMEOUT_MS;
    while (Date.now() < until) {
      for (const page of ctx.pages()) {
        if (page.isClosed()) continue;
        if (await this.pageId(page) === targetId) {
          this.adopt(page);
          return page;
        }
      }
      await new Promise((r) => setTimeout(r, 25));
    }
    throw new Error(`Chrome created tab ${targetId} but it was not attached in time. Use browser_tabs list to inspect it.`);
  }

  /** Explicit human handoff only: restore a minimized window before foregrounding. */
  async focus(page: Page): Promise<void> {
    const browser = await this.connect();
    const cdp = await browser.newBrowserCDPSession();
    try {
      const { windowId, bounds } = await cdp.send("Browser.getWindowForTarget", { targetId: await this.pageId(page) });
      if (bounds.windowState === "minimized") {
        await cdp.send("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
      }
      await page.bringToFront();
    } finally { await cdp.detach(); }
  }

  currentPage(): Page | null {
    return this.page && !this.page.isClosed() ? this.page : null;
  }

  /** Make `page` the driven tab and start buffering its console/network. */
  adopt(page: Page): void {
    if (this.page === page) return;
    this.detachPage?.();
    this.page = page;
    this.pageLost = false;
    this.consoleBuf = [];
    this.networkBuf = [];
    this.inflight.clear();

    const onConsole = (msg: ConsoleMessage) => void this.recordConsole(msg);
    const onPageError = (err: Error) => {
      // First stack frame is the throw site; the message alone rarely says where.
      const frame = err.stack?.split("\n").find((l) => /^\s+at /.test(l))?.trim().replace(/^at\s+/, "");
      this.pushConsole({ ts: Date.now(), level: "pageerror", text: `Uncaught ${err.message}`, location: frame });
    };
    const onRequest = (req: Request) => {
      const entry: NetworkEntry = {
        ts: Date.now(),
        method: req.method(),
        url: req.url(),
        resourceType: req.resourceType(),
        done: false,
      };
      this.inflight.set(req, entry);
      this.networkBuf.push(entry);
      if (this.networkBuf.length > NETWORK_CAP) this.networkBuf.shift();
    };
    const onResponse = (res: Response) => {
      const entry = this.inflight.get(res.request());
      if (entry) entry.status = res.status();
    };
    const onFinished = (req: Request) => void this.finishRequest(req);
    const onFailed = (req: Request) => {
      const entry = this.inflight.get(req);
      if (!entry) return;
      entry.failure = req.failure()?.errorText ?? "failed";
      entry.durationMs = Date.now() - entry.ts;
      entry.done = true;
      this.inflight.delete(req);
    };
    const onClose = () => {
      if (this.page === page) {
        this.detachPage?.();
        this.detachPage = null;
        this.page = null;
        this.pageLost = true;
      }
    };

    page.on("console", onConsole);
    page.on("pageerror", onPageError);
    page.on("request", onRequest);
    page.on("response", onResponse);
    page.on("requestfinished", onFinished);
    page.on("requestfailed", onFailed);
    page.on("close", onClose);

    this.detachPage = () => {
      page.off("console", onConsole);
      page.off("pageerror", onPageError);
      page.off("request", onRequest);
      page.off("response", onResponse);
      page.off("requestfinished", onFinished);
      page.off("requestfailed", onFailed);
      page.off("close", onClose);
    };
  }

  // ---- buffers ----------------------------------------------------------

  private pushConsole(entry: ConsoleEntry): void {
    this.consoleBuf.push(entry);
    if (this.consoleBuf.length > CONSOLE_CAP) this.consoleBuf.shift();
  }

  private async recordConsole(msg: ConsoleMessage): Promise<void> {
    const ts = Date.now();
    let text = msg.text();
    // Chrome previews objects as "JSHandle@object" (older) or "{a: {…}}" with nested
    // parts elided; resolve the real values so the model sees the whole thing.
    if (text.includes("JSHandle@") || text.includes("…")) {
      try {
        const values = await Promise.all(
          msg.args().map((a) => a.jsonValue().catch(() => "<unserializable>")),
        );
        text = values.map((v) => (typeof v === "string" ? v : safeStringify(v))).join(" ");
      } catch {
        /* keep the raw text */
      }
    }
    const loc = msg.location();
    const location = loc?.url ? `${loc.url}:${loc.lineNumber + 1}:${loc.columnNumber + 1}` : undefined;
    this.pushConsole({ ts, level: msg.type(), text, location });
  }

  private async finishRequest(req: Request): Promise<void> {
    const entry = this.inflight.get(req);
    if (!entry) return;
    entry.durationMs = Date.now() - entry.ts;
    entry.done = true;
    this.inflight.delete(req);

    // Bodies only for failed API/document calls: that is where the error message lives.
    if (!isFailure(entry) || !BODY_TYPES.has(entry.resourceType)) return;
    const post = req.postData();
    if (post) entry.requestBody = clip(post, BODY_CAP);
    try {
      const body = await (await req.response())?.text();
      if (body) entry.responseBody = clip(body, BODY_CAP);
    } catch {
      /* body already gone; the status line is still useful */
    }
  }

  /** Console entries, optionally only those at/after `sinceTs`. Does not clear. */
  console(sinceTs = 0): ConsoleEntry[] {
    return sinceTs ? this.consoleBuf.filter((e) => e.ts >= sinceTs) : [...this.consoleBuf];
  }

  /** Network entries, optionally only those started at/after `sinceTs`. Does not clear. */
  network(sinceTs = 0): NetworkEntry[] {
    return sinceTs ? this.networkBuf.filter((e) => e.ts >= sinceTs) : [...this.networkBuf];
  }

  clearConsole(): void {
    this.consoleBuf = [];
  }

  clearNetwork(): void {
    // Keep in-flight entries so their completion still lands somewhere visible.
    this.networkBuf = this.networkBuf.filter((e) => !e.done);
  }
}

export function safeStringify(value: unknown, indent = 0): string {
  try {
    const s = JSON.stringify(value, null, indent);
    return s === undefined ? String(value) : s;
  } catch {
    return String(value);
  }
}

export function clip(s: string, max: number): string {
  return s.length > max ? `${s.slice(0, max)}… [${s.length - max} more chars]` : s;
}
