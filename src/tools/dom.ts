import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { ACTION_TIMEOUT_MS, bounded, explain, textResult, withAbort, type ToolRegistrar } from "./shared";

const MAX_MATCHES = 20;
const DEFAULT_MAX_CHARS = 20_000;

const parameters = Type.Object({
  selector: Type.Optional(
    Type.String({ description: "CSS or Playwright selector (default body). Up to 20 matches are returned." }),
  ),
  mode: Type.Optional(
    StringEnum(["aria", "text", "html"] as const, {
      description:
        "aria (default): accessibility tree — roles, names, values, structure; compact and the best way " +
        "to find selectors. text: rendered innerText. html: outerHTML.",
    }),
  ),
  maxChars: Type.Optional(Type.Number({ description: `Truncate output to this many characters (default ${DEFAULT_MAX_CHARS}).` })),
});

export const registerDom: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_dom",
    label: "Browser DOM",
    description:
      "Inspect the current page's structure. mode aria returns the accessibility tree (what a screen " +
      "reader sees: roles, names, states), which is compact and ideal for finding elements to interact " +
      "with. text returns visible text, html returns markup. Scope with a selector to keep output small.",
    promptSnippet: "Read the live page's accessibility tree, text or HTML",
    parameters,
    async execute(_id, params, signal) {
      const page = await session.getPage();
      const selector = params.selector ?? "body";
      const mode = params.mode ?? "aria";
      const loc = page.locator(selector);

      let count: number;
      let out: string;
      try {
        count = await withAbort(loc.count(), signal);
        if (count === 0) throw new Error(`No element matches "${selector}"`);
        if (mode === "aria") {
          out = await withAbort(loc.first().ariaSnapshot({ timeout: ACTION_TIMEOUT_MS }), signal);
        } else {
          const n = Math.min(count, MAX_MATCHES);
          const parts: string[] = [];
          for (let i = 0; i < n; i++) {
            const el = loc.nth(i);
            const s =
              mode === "text"
                ? await el.innerText({ timeout: ACTION_TIMEOUT_MS })
                : await el.evaluate((e) => (e as Element).outerHTML, undefined, { timeout: ACTION_TIMEOUT_MS });
            parts.push(n > 1 ? `[${i}]\n${s}` : s);
            if (signal?.aborted) throw new Error("Cancelled");
          }
          out = parts.join("\n---\n");
        }
      } catch (e) {
        throw explain(e);
      }

      const shown = mode === "aria" ? 1 : Math.min(count, MAX_MATCHES);
      const header =
        count === 1 && selector === "body"
          ? `${mode} of ${page.url()}`
          : `${count} match(es) for "${selector}", showing ${shown} (${mode})`;
      const text = bounded(`${header}\n\n${out}`, "head", params.maxChars ?? DEFAULT_MAX_CHARS);
      return textResult(text, { selector, mode, count });
    },
  });
};
