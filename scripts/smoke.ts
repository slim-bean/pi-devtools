/**
 * End-to-end check without an LLM: launch/attach Chrome, serve a small app
 * that misbehaves on purpose, and exercise every session capability.
 *
 *   npm run smoke
 */
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { formatConsole, formatNetwork, sinceSummary } from "../src/format";
import { launchChrome } from "../src/launch";
import { DevtoolsSession } from "../src/session";
import { evalInPage } from "../src/page";

const PAGE = `<!doctype html><html><head><title>smoke app</title></head><body>
<h1>Smoke</h1>
<form id="f"><label>Name <input id="name" name="name"></label>
<button id="go" type="button">Go</button></form>
<ul id="out"></ul>
<img src="/missing.png" alt="missing">
<script>
  console.log("boot", { ready: true });
  console.warn("a warning");
  document.getElementById("go").addEventListener("click", async () => {
    const name = document.getElementById("name").value;
    const li = document.createElement("li"); li.textContent = "clicked:" + name;
    document.getElementById("out").appendChild(li);
    const r = await fetch("/api/boom", { method: "POST", body: JSON.stringify({ name }) });
    if (!r.ok) console.error("api failed", r.status);
  });
  setTimeout(() => { throw new Error("late uncaught"); }, 50);
  window.__state = { items: [1, 2, 3], user: { name: "ed" } };
</script></body></html>`;

function check(cond: unknown, msg: string): void {
  if (!cond) throw new Error(`FAIL: ${msg}`);
  console.log(`ok   ${msg}`);
}

async function main(): Promise<void> {
  const server = createServer((req, res) => {
    if (req.url === "/") return res.writeHead(200, { "content-type": "text/html" }).end(PAGE);
    if (req.url === "/api/boom") {
      return res.writeHead(500, { "content-type": "application/json" }).end(JSON.stringify({ error: "kaboom" }));
    }
    res.writeHead(404).end("nope");
  });
  await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  console.log(`serving ${base}`);

  console.log(`chrome: ${await launchChrome()}`);
  const session = new DevtoolsSession();
  let page: Awaited<ReturnType<DevtoolsSession["newPage"]>> | undefined;
  try {
    // A dedicated tab, closed below, so repeated runs don't litter the window.
    page = await session.newPage();
    const t0 = Date.now();
    const res = await page.goto(base, { waitUntil: "load" });
    check(res?.status() === 200, "navigate returns 200");
    check((await page.title()) === "smoke app", "title read");

    await page.waitForTimeout(300); // let the late error and the 404 image land
    const con = session.console();
    check(con.some((e) => e.level === "log" && /ready.*true/.test(e.text)), "console.log with object arg captured");
    check(con.some((e) => e.level === "warning"), "console.warn captured");
    check(con.some((e) => e.level === "pageerror" && e.text.includes("late uncaught")), "uncaught exception captured");

    const net = session.network();
    check(net.some((e) => e.url.endsWith("/missing.png") && e.status === 404), "404 asset recorded");

    const state = await evalInPage(page, "window.__state");
    check((state as { items: number[] }).items.length === 3, "eval expression");
    const stmt = await evalInPage(page, "const n = window.__state.items.length; return n * 2;");
    check(stmt === 6, "eval statements with return");
    const awaited = await evalInPage(page, "await new Promise(r => setTimeout(() => r('later'), 20))");
    check(awaited === "later", "eval await");

    await page.locator("#name").fill("bob");
    const t1 = Date.now();
    await page.locator("#go").click();
    await page.waitForLoadState("networkidle", { timeout: 2000 }).catch(() => {});
    const boom = session.network(t1).find((e) => e.url.endsWith("/api/boom"));
    check(boom?.status === 500, "POST /api/boom recorded as 500");
    check(boom?.requestBody?.includes("bob"), "request body captured on failure");
    check(boom?.responseBody?.includes("kaboom"), "response body captured on failure");
    check(session.console(t1).some((e) => e.level === "error" && e.text.includes("api failed 500")), "console.error after click");

    const summary = sinceSummary(session, t1, page.url());
    check(summary.some((l) => /^Console: [1-9]\d* error/.test(l)), "since-summary counts console errors");
    check(summary.some((l) => l.includes("/api/boom → 500")), "since-summary lists failed request");

    const aria = await page.locator("body").ariaSnapshot();
    check(/button "Go"/.test(aria), "aria snapshot shows the button");
    check((await page.locator("#out li").innerText()) === "clicked:bob", "DOM text after interaction");

    const png = await page.screenshot({ type: "png", scale: "css" });
    check(png.length > 1000, `screenshot captured (${png.length} bytes)`);

    const tabs = await session.listPages();
    check(tabs.includes(page), "listPages includes driven tab");

    console.log("\n--- sample browser_console output ---\n" + formatConsole(session.console(t0)));
    console.log("\n--- sample browser_network output (api) ---\n" + formatNetwork(
      session.network(t0).filter((e) => ["document", "fetch", "xhr"].includes(e.resourceType) || e.status === 404),
      page.url(),
    ));

    console.log("\nall checks passed");
  } finally {
    await page?.close().catch(() => {});
    await session.close();
    server.closeAllConnections(); // Chrome keeps connections alive; close() alone would hang
    server.close();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
