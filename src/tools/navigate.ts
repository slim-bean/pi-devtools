import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { normalizeUrl, sinceSummary, whereAmI } from "../format";
import { explain, NAV_TIMEOUT_MS, textResult, withAbort, type ToolRegistrar } from "./shared";

const parameters = Type.Object({
  url: Type.String({
    description: "URL to open. Scheme is optional: 'localhost:3000' becomes http://localhost:3000.",
  }),
  waitUntil: Type.Optional(
    StringEnum(["load", "domcontentloaded", "networkidle", "commit"] as const, {
      description:
        "When navigation counts as done (default load). networkidle also waits for 500ms with no " +
        "requests; use it for SPAs that fetch data on mount.",
    }),
  ),
  timeoutMs: Type.Optional(Type.Number({ description: `Navigation timeout in ms (default ${NAV_TIMEOUT_MS}).` })),
});

export const registerNavigate: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_navigate",
    label: "Browser Navigate",
    description:
      "Open a URL in the live Chrome tab that pi-devtools drives. The tab persists across calls, so " +
      "state, logins and SPA routes carry over. Returns the final URL, title, HTTP status, load time, " +
      "and a summary of console errors and failed requests seen during the load.",
    promptSnippet: "Open a URL in the live local Chrome tab (persistent across calls)",
    promptGuidelines: [
      "Use browser_navigate to open the app under development (e.g. localhost:3000) in a real Chrome, " +
        "then use browser_console, browser_network, browser_eval, browser_dom, browser_screenshot and " +
        "browser_interact on that same tab.",
      "When browser_navigate, browser_interact or browser_wait report console errors or failed requests, " +
        "read browser_console / browser_network before guessing at the cause.",
    ],
    parameters,
    async execute(_id, params, signal, onUpdate) {
      const page = await session.getPage();
      const url = normalizeUrl(params.url);
      onUpdate?.({ content: [{ type: "text", text: `Navigating to ${url}…` }], details: {} });

      const started = Date.now();
      let response;
      try {
        response = await withAbort(
          page.goto(url, { waitUntil: params.waitUntil ?? "load", timeout: params.timeoutMs ?? NAV_TIMEOUT_MS }),
          signal,
        );
      } catch (e) {
        throw explain(e, url);
      }
      const ms = Date.now() - started;
      const status = response ? `HTTP ${response.status()}` : "no HTTP response (same-document or about: navigation)";

      const lines = [`Navigated to ${await whereAmI(page)}`, `${status} in ${ms}ms`];
      lines.push(...sinceSummary(session, started, page.url()));
      return textResult(lines.join("\n"), { url: page.url(), status: response?.status() ?? null, ms });
    },
  });
};
