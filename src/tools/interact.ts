import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { sinceSummary, whereAmI } from "../format";
import { ACTIONS, performInteraction, validateInteraction } from "../interaction";
import { ACTION_TIMEOUT_MS, explain, SETTLE_MS, textResult, withAbort, type ToolRegistrar } from "./shared";

const parameters = Type.Object({
  action: StringEnum(ACTIONS, {
    description:
      "click | dblclick | hover | check | uncheck: on the element. fill: clear then set an input's " +
      "value. type: press keys one by one (triggers per-key handlers). press: a key like Enter, Tab, " +
      "Escape, ArrowDown, Control+a (on the element, or on the focused element if no selector). " +
      "select: choose <option> by value or label.",
  }),
  selector: Type.Optional(
    Type.String({
      description:
        "CSS or Playwright selector: '#save', 'button:has-text(\"Save\")', 'text=Sign in', " +
        "'role=button[name=\"Save\"]', '[data-testid=x]', 'xpath=//a'. Must match exactly one element; " +
        'use browser_dom (mode aria) to find candidates. Snapshot button "Reload" means ' +
        'role=button[name="Reload"], not button:has-text("Reload"). CSS/role/text selectors pierce open shadow roots; XPath does not.',
    }),
  ),
  value: Type.Optional(Type.String({ description: "Only for fill/type (text), press (key), or select (option). Rejected for other actions; no coordinate clicks." })),
  timeoutMs: Type.Optional(Type.Number({ description: `Wait up to this long for the element (default ${ACTION_TIMEOUT_MS}).` })),
});

export const registerInteract: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_interact",
    executionMode: "sequential",
    label: "Browser Interact",
    description:
      "Click, type, press keys, hover, check boxes or pick options in the current tab, like a user " +
      "would. Waits for the element to be actionable, then gives the page up to 2s to settle and " +
      "reports where the tab ended up plus any new console errors or failed requests.",
    promptSnippet: "Click / type / press keys / select in the live page",
    promptGuidelines: [
      "Use browser_dom with mode aria to discover roles, names and structure before choosing a selector " +
        'for browser_interact. Snapshot button "Reload" maps to role=button[name="Reload"]; roles are not HTML tags ' +
        "and accessible names are not necessarily text content. Prefer role selectors for controls.",
    ],
    parameters,
    async execute(_id, params, signal) {
      validateInteraction(params.action, params.selector, params.value);
      const page = await session.getPage();
      const timeout = params.timeoutMs ?? ACTION_TIMEOUT_MS;
      const started = Date.now();
      try {
        await withAbort(performInteraction(page, params.action, params.selector, params.value, timeout), signal);
      } catch (e) {
        throw explain(e, undefined, params.selector);
      }
      // Let click handlers fire and their requests land, bounded so long-polling apps don't stall us.
      await page.waitForLoadState("networkidle", { timeout: SETTLE_MS }).catch(() => {});

      const what = params.selector ? `${params.action} ${params.selector}` : `${params.action} ${params.value}`;
      const shown = params.value !== undefined && params.selector ? ` (${JSON.stringify(params.value)})` : "";
      const lines = [`Done: ${what}${shown}`, `Now at ${await whereAmI(page)}`];
      lines.push(...sinceSummary(session, started, page.url()));
      return textResult(lines.join("\n"), { action: params.action, selector: params.selector ?? null, url: page.url() });
    },
  });
};
