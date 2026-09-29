/**
 * pi-devtools — drive a live, user-launched Chrome from pi.
 *
 * Tools: browser_navigate, browser_tabs, browser_console, browser_network,
 * browser_eval, browser_dom, browser_screenshot, browser_interact, browser_wait.
 * Command: /devtools [status|launch|disconnect].
 *
 * Configuration: PI_DEVTOOLS_CDP_URL (default http://127.0.0.1:9222).
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { registerCommand } from "./command";
import { DevtoolsSession } from "./session";
import { ensureRuntime, probe, verifyIdentity } from "./launch";
import { autoLaunch } from "./config";
import { registerTools } from "./tools";

export default function (pi: ExtensionAPI) {
  // Nothing connects until a tool or /devtools is used; the factory must not
  // open sockets (pi may load extensions in runs that never start a session).
  const session = new DevtoolsSession();

  registerTools(pi, session);
  registerCommand(pi, session);

  // Public, versioned integration channels. The request receives its Promise
  // synchronously, so callers can detect an absent extension without a timeout.
  pi.events.on("pi-devtools:runtime:v1", (data) => {
    const request = data as { operation: "ensure" | "status" | "focus"; result?: Promise<unknown> };
    request.result = (async () => {
      if (request.operation === "ensure") return ensureRuntime();
      if (request.operation === "focus") {
        await ensureRuntime();
        const page = await session.getPage(true);
        await session.focus(page);
        return { url: page.url() };
      }
      if (request.operation !== "status") throw new Error("Unknown devtools runtime operation");
      const version = await probe();
      if (version && autoLaunch()) await verifyIdentity(version);
      return version;
    })();
  });
  pi.events.on("pi-devtools:snapshot:v1", (data) => {
    const request = data as { result?: Promise<{ html: string; url: string; title: string }> };
    request.result = (async () => {
      const page = await session.getPage();
      return { html: await page.content(), url: page.url(), title: await page.title() };
    })();
  });

  pi.on("session_shutdown", async () => {
    await session.close();
  });
}
