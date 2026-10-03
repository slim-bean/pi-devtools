import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { inspectShadowDOM } from "../dom";
import { ACTION_TIMEOUT_MS, bounded, explain, textResult, withAbort, type ToolRegistrar } from "./shared";

const MAX_MATCHES = 20;
const DEFAULT_MAX_CHARS = 20_000;

const parameters = Type.Object({
  selector: Type.Optional(
    Type.String({ description: "CSS or Playwright selector (default body). Up to 20 matches are returned." }),
  ),
  mode: Type.Optional(
    StringEnum(["aria", "text", "html", "shadow"] as const, {
      description:
        "aria (default): accessibility tree — roles, names, values, structure; compact and the best way " +
        "to find selectors. text: native innerText (may omit shadow content). html: outerHTML (omits shadow roots). " +
        "shadow: bounded structural outline of light DOM and open shadow roots, including attributes and text; not visibility-filtered HTML.",
    }),
  ),
  maxChars: Type.Optional(Type.Number({ description: `Truncate output to this many characters (default ${DEFAULT_MAX_CHARS}).` })),
});

export const registerDom: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_dom",
    executionMode: "sequential",
    label: "Browser DOM",
    description:
      "Inspect the current page's structure. mode aria returns the accessibility tree (what a screen " +
      "reader sees: roles, names, states), which is compact and ideal for finding elements to interact " +
      "with. text/html use native innerText/outerHTML and may omit shadow content. shadow returns an annotated " +
      "DOM outline including open shadow roots (not closed roots or iframe documents). Scope with a selector to keep output small.",
    promptSnippet: "Read the live page's accessibility tree, text, HTML or open-shadow DOM outline",
    promptGuidelines: [
      "browser_dom and browser_interact CSS/role/text selectors already pierce open shadow roots; XPath and " +
        "browser_eval's native DOM queries do not. Use browser_dom mode shadow for structure when text/html omit shadow content. " +
        "Closed shadow roots are unsupported; do not infer a closed root from an empty query.",
    ],
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
            const s = await withAbort(
              mode === "shadow"
                ? inspectShadowDOM(el, params.maxChars ?? DEFAULT_MAX_CHARS, ACTION_TIMEOUT_MS)
                : mode === "text"
                  ? el.innerText({ timeout: ACTION_TIMEOUT_MS })
                  : el.evaluate((e) => (e as Element).outerHTML, undefined, { timeout: ACTION_TIMEOUT_MS }),
              signal,
            );
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
      const note = mode === "text" || mode === "html"
        ? "\nNative text/HTML may omit shadow content; use mode aria for controls or mode shadow for open-shadow structure."
        : mode === "shadow"
          ? "\nStructural outline (not HTML or visible text): light DOM + open roots; slots not expanded; closed roots/frames not entered. Script/style/template contents omitted."
          : "";
      const text = bounded(`${header}${note}\n\n${out}`, "head", params.maxChars ?? DEFAULT_MAX_CHARS);
      return textResult(text, { selector, mode, count });
    },
  });
};
