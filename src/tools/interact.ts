import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import type { Page } from "playwright-core";
import { sinceSummary, whereAmI } from "../format";
import { ACTION_TIMEOUT_MS, explain, SETTLE_MS, textResult, withAbort, type ToolRegistrar } from "./shared";

const ACTIONS = ["click", "dblclick", "fill", "type", "press", "hover", "check", "uncheck", "select"] as const;
type Action = (typeof ACTIONS)[number];

const NEEDS_VALUE = new Set<Action>(["fill", "type", "press", "select"]);

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
        "use browser_dom (mode aria) to find candidates.",
    }),
  ),
  value: Type.Optional(Type.String({ description: "Text for fill/type, key for press, option for select." })),
  timeoutMs: Type.Optional(Type.Number({ description: `Wait up to this long for the element (default ${ACTION_TIMEOUT_MS}).` })),
});

async function perform(page: Page, action: Action, selector: string | undefined, value: string | undefined, timeout: number) {
  if (action === "press" && !selector) {
    await page.keyboard.press(value!);
    return;
  }
  if (!selector) throw new Error(`${action} needs a selector`);
  const el = page.locator(selector);
  switch (action) {
    case "click": return el.click({ timeout });
    case "dblclick": return el.dblclick({ timeout });
    case "hover": return el.hover({ timeout });
    case "check": return el.check({ timeout });
    case "uncheck": return el.uncheck({ timeout });
    case "fill": return el.fill(value!, { timeout });
    case "type": return el.pressSequentially(value!, { timeout });
    case "press": return el.press(value!, { timeout });
    case "select": return el.selectOption(value!, { timeout }).then(() => undefined);
  }
}

export const registerInteract: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_interact",
    label: "Browser Interact",
    description:
      "Click, type, press keys, hover, check boxes or pick options in the current tab, like a user " +
      "would. Waits for the element to be actionable, then gives the page up to 2s to settle and " +
      "reports where the tab ended up plus any new console errors or failed requests.",
    promptSnippet: "Click / type / press keys / select in the live page",
    promptGuidelines: [
      "Use browser_dom with mode aria to discover roles, names and structure before choosing a selector " +
        "for browser_interact; prefer role=, text= or data-testid selectors over brittle CSS paths.",
    ],
    parameters,
    async execute(_id, params, signal) {
      if (NEEDS_VALUE.has(params.action) && params.value === undefined) {
        throw new Error(`${params.action} requires a value`);
      }
      const page = await session.getPage();
      const timeout = params.timeoutMs ?? ACTION_TIMEOUT_MS;
      const started = Date.now();
      try {
        await withAbort(perform(page, params.action, params.selector, params.value, timeout), signal);
      } catch (e) {
        throw explain(e);
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
