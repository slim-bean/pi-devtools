import { Type } from "typebox";
import { evalInPage } from "../page";
import { safeStringify } from "../session";
import { ACTION_TIMEOUT_MS, bounded, explain, textResult, withAbort, withTimeout, type ToolRegistrar } from "./shared";

const parameters = Type.Object({
  expression: Type.String({
    description:
      "JavaScript to run in the page's main world. Either a single expression, or statements ending " +
      "in `return …`; `await` is allowed. The result must be JSON-serializable: map DOM nodes to " +
      "plain data, e.g. [...document.querySelectorAll('li')].map(e => e.textContent).",
  }),
  timeoutMs: Type.Optional(Type.Number({ description: `Give up after this many ms (default ${ACTION_TIMEOUT_MS}).` })),
});

export const registerEval: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_eval",
    label: "Browser Eval",
    description:
      "Run JavaScript in the current page and return the JSON-serialized result. Use it to inspect " +
      "application state (window globals, framework stores, localStorage, DOM properties, computed " +
      "styles), call the app's own functions, or dispatch events. Non-serializable values (DOM nodes, " +
      "functions) come back as undefined or {}.",
    promptSnippet: "Run JavaScript in the live page and get the result",
    promptGuidelines: [
      "Prefer browser_eval to read state (globals, store contents, element properties) over interpreting " +
        "screenshots; use browser_screenshot for layout and visual questions.",
    ],
    parameters,
    async execute(_id, params, signal) {
      const page = await session.getPage();
      const ms = params.timeoutMs ?? ACTION_TIMEOUT_MS;
      let value: unknown;
      try {
        value = await withAbort(withTimeout(evalInPage(page, params.expression), ms, "browser_eval"), signal);
      } catch (e) {
        throw explain(e);
      }
      const text = value === undefined ? "undefined" : safeStringify(value, 2);
      return textResult(bounded(text, "head"), { type: typeof value });
    },
  });
};
