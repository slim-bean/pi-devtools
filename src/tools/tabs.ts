import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Page } from "playwright-core";
import { normalizeUrl, whereAmI } from "../format";
import type { DevtoolsSession } from "../session";
import { explain, NAV_TIMEOUT_MS, textResult, type ToolRegistrar } from "./shared";

const parameters = Type.Object({
  action: StringEnum(["list", "use", "new", "close"] as const, {
    description:
      "list: all open tabs (current marked *). use: drive tab `index` from now on — e.g. one the user " +
      "already has open. new: open a fresh tab (optionally at `url`) and drive it. close: close tab " +
      "`index` (default: the current one).",
  }),
  index: Type.Optional(Type.Number({ description: "Tab index from `list`." })),
  url: Type.Optional(Type.String({ description: "For new: URL to open in the tab." })),
});

async function listing(session: DevtoolsSession): Promise<string> {
  const pages = await session.listPages();
  const current = session.currentPage();
  if (pages.length === 0) return "No open tabs.";
  const lines = await Promise.all(
    pages.map(async (p, i) => `${i}${p === current ? " *" : "  "} ${await whereAmI(p)}`),
  );
  return lines.join("\n");
}

function pick(pages: Page[], index: number | undefined, what: string): Page {
  if (index === undefined) throw new Error(`${what} needs an index; call browser_tabs list first`);
  const p = pages[index];
  if (!p) throw new Error(`No tab at index ${index} (have ${pages.length}); call browser_tabs list`);
  return p;
}

export const registerTabs: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_tabs",
    label: "Browser Tabs",
    description:
      "List Chrome's open tabs, switch which tab pi-devtools drives (for example one the user already " +
      "has open and is asking about), open a new tab, or close one. Console/network buffers restart " +
      "when the driven tab changes.",
    promptSnippet: "List / switch / open / close tabs in the live Chrome",
    promptGuidelines: [
      "When the user refers to a page they already have open ('this tab', 'the page I'm looking at'), " +
        "use browser_tabs list then browser_tabs use rather than navigating afresh.",
    ],
    parameters,
    async execute(_id, params) {
      switch (params.action) {
        case "list":
          return textResult(await listing(session));

        case "use": {
          const page = pick(await session.listPages(), params.index, "use");
          session.adopt(page);
          await page.bringToFront().catch(() => {});
          return textResult(`Now driving tab ${params.index}: ${await whereAmI(page)}`, { url: page.url() });
        }

        case "new": {
          const page = await session.newPage();
          if (params.url) {
            const url = normalizeUrl(params.url);
            try {
              await page.goto(url, { timeout: NAV_TIMEOUT_MS });
            } catch (e) {
              throw explain(e, url);
            }
          }
          return textResult(`Opened and now driving: ${await whereAmI(page)}`, { url: page.url() });
        }

        case "close": {
          const pages = await session.listPages();
          const target = params.index === undefined ? session.currentPage() : pick(pages, params.index, "close");
          if (!target) throw new Error("No current tab to close; pass an index");
          if (pages.length === 1) {
            throw new Error("Refusing to close the last tab: Chrome would exit and pi-devtools would lose its connection. Navigate elsewhere or use browser_tabs new first.");
          }
          const was = await whereAmI(target);
          await target.close();
          return textResult(`Closed ${was}\n\nRemaining tabs:\n${await listing(session)}`);
        }
      }
    },
  });
};
