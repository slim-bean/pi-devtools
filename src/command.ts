/**
 * `/devtools` — status, launch Chrome, disconnect.
 */
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import { LAUNCH_SCRIPT, launchChrome, probe } from "./launch";
import { cdpUrl, type DevtoolsSession } from "./session";

const SUBCOMMANDS = ["status", "launch", "disconnect"] as const;

export function registerCommand(pi: ExtensionAPI, session: DevtoolsSession): void {
  pi.registerCommand("devtools", {
    description: "Live Chrome debug tools: /devtools [status|launch [url]|disconnect]",
    getArgumentCompletions(prefix) {
      const items = SUBCOMMANDS.filter((s) => s.startsWith(prefix)).map((s) => ({ value: s, label: s }));
      return items.length ? items : null;
    },
    async handler(args, ctx) {
      const [sub = "status", ...rest] = args.trim().split(/\s+/).filter(Boolean);

      switch (sub) {
        case "status": {
          const url = cdpUrl();
          if (session.isConnected()) {
            const page = session.currentPage();
            const where = page ? `driving ${page.url()}` : "no tab adopted yet";
            ctx.ui.notify(`pi-devtools: attached to Chrome at ${url}; ${where}`, "info");
            return;
          }
          const v = await probe();
          if (v) {
            ctx.ui.notify(`pi-devtools: ${v.browser} is listening at ${url}; will attach on first tool call`, "info");
          } else {
            ctx.ui.notify(
              `pi-devtools: nothing at ${url}. Run /devtools launch, or ${LAUNCH_SCRIPT}, or set PI_DEVTOOLS_CDP_URL`,
              "warning",
            );
          }
          return;
        }

        case "launch": {
          ctx.ui.notify("pi-devtools: starting Chrome…", "info");
          try {
            const version = await launchChrome(rest);
            ctx.ui.notify(`pi-devtools: ${version} ready at ${cdpUrl()}`, "info");
          } catch (e) {
            ctx.ui.notify(`pi-devtools: ${(e as Error).message}`, "error");
          }
          return;
        }

        case "disconnect": {
          await session.close();
          ctx.ui.notify("pi-devtools: disconnected (Chrome keeps running)", "info");
          return;
        }

        default:
          ctx.ui.notify(`Unknown subcommand "${sub}". Use: ${SUBCOMMANDS.join(" | ")}`, "warning");
      }
    },
  });
}
