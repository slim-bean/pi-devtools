import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Page } from "playwright-core";
import { normalizeUrl, whereAmI } from "../format";
import type { DevtoolsSession } from "../session";
import { explain, NAV_TIMEOUT_MS, textResult, type ToolRegistrar } from "./shared";

const parameters = Type.Object({
  action: StringEnum(["list", "use", "new", "close", "focus"] as const, {
    description: "list: open tabs, current marked *. use: select without changing desktop focus. new: create a background tab. close: close selected/current tab. focus: explicitly bring selected/current tab forward for human handoff.",
  }),
  id: Type.Optional(Type.String({ description: "Stable tab id from list (preferred; valid until the tab/browser closes)." })),
  index: Type.Optional(Type.Integer({ minimum: 0, description: "Legacy list index. Can change when another conversation opens/closes tabs; prefer id." })),
  url: Type.Optional(Type.String({ description: "For new: URL to open." })),
});

async function listing(session: DevtoolsSession): Promise<string> {
  const pages = await session.listPages();
  if (!pages.length) return "No open tabs.";
  return (await Promise.all(pages.map(async (p, i) =>
    `${i}${p === session.currentPage() ? " *" : "  "} id=${await session.pageId(p)} ${await whereAmI(p)}`,
  ))).join("\n");
}

export const registerTabs: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_tabs", label: "Browser Tabs", executionMode: "sequential",
    description: "List, select, open or close tabs in the shared Chrome. Each conversation has its own selected tab. " +
      "Select another tab only deliberately; it may belong to the user or another agent. Buffers reset on selection. " +
      "Ids are stable during a browser run; indices may shift. Selecting/creating tabs does not bring Chrome forward; use focus only for an explicit human handoff.",
    promptSnippet: "Manage tabs in the shared Chrome; this conversation has its own selected tab",
    promptGuidelines: [
      "When the user refers to an existing page, use browser_tabs list then use with its id rather than navigating afresh.",
      "Use browser_tabs new for independent work. Do not take over or close unrelated tabs, including blank worker tabs.",
      "Use browser_tabs focus only when the user wants Chrome brought forward (for example login/MFA); routine work must not steal desktop focus.",
    ],
    parameters,
    async execute(_id, params) {
      const pick = async (): Promise<Page> => {
        const pages = await session.listPages();
        if (params.id !== undefined && params.index !== undefined) throw new Error("Pass id or index, not both.");
        if (params.id !== undefined) {
          for (const p of pages) if (await session.pageId(p) === params.id) return p;
        } else if (params.index !== undefined && pages[params.index]) return pages[params.index];
        throw new Error("Tab not found; call browser_tabs list and use a current id.");
      };
      switch (params.action) {
        case "list": return textResult(await listing(session));
        case "use": {
          const page = await pick();
          session.adopt(page);
          return textResult(`Now driving id=${await session.pageId(page)}: ${await whereAmI(page)}`, { url: page.url() });
        }
        case "new": {
          const page = await session.newPage();
          if (params.url) {
            const url = normalizeUrl(params.url);
            try { await page.goto(url, { timeout: NAV_TIMEOUT_MS }); } catch (e) { throw explain(e, url); }
          }
          return textResult(`Opened id=${await session.pageId(page)}: ${await whereAmI(page)}`, { url: page.url() });
        }
        case "focus": {
          const page = params.id !== undefined || params.index !== undefined ? await pick() : session.currentPage();
          if (!page) throw new Error("No current tab; select one with browser_tabs use first.");
          session.adopt(page);
          await session.focus(page);
          return textResult(`Brought forward: ${await whereAmI(page)}`);
        }
        case "close": {
          const target = params.id !== undefined || params.index !== undefined ? await pick() : session.currentPage();
          if (!target) throw new Error("No current tab; pass an id.");
          if ((await session.listPages()).length === 1) throw new Error("Refusing to close the last tab; Chrome would exit.");
          const was = await whereAmI(target);
          await target.close();
          return textResult(`Closed ${was}\n\n${await listing(session)}`);
        }
      }
    },
  });
};
