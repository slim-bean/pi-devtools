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
import { registerTools } from "./tools";

export default function (pi: ExtensionAPI) {
  // Nothing connects until a tool or /devtools is used; the factory must not
  // open sockets (pi may load extensions in runs that never start a session).
  const session = new DevtoolsSession();

  registerTools(pi, session);
  registerCommand(pi, session);

  pi.on("session_shutdown", async () => {
    await session.close();
  });
}
