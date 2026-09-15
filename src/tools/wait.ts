import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { sinceSummary, whereAmI } from "../format";
import { ACTION_TIMEOUT_MS, explain, textResult, withAbort, type ToolRegistrar } from "./shared";

const parameters = Type.Object({
  selector: Type.Optional(Type.String({ description: "Wait for an element matching this selector…" })),
  state: Type.Optional(
    StringEnum(["visible", "hidden", "attached", "detached"] as const, {
      description: "…to reach this state (default visible).",
    }),
  ),
  urlContains: Type.Optional(Type.String({ description: "Wait until the page URL contains this substring." })),
  networkIdle: Type.Optional(Type.Boolean({ description: "Wait until there have been no requests for 500ms." })),
  ms: Type.Optional(Type.Number({ description: "Plain sleep, in ms. Prefer the conditions above." })),
  timeoutMs: Type.Optional(Type.Number({ description: `Give up after this many ms (default ${ACTION_TIMEOUT_MS}).` })),
});

export const registerWait: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_wait",
    label: "Browser Wait",
    description:
      "Wait for the page to reach a condition: an element appears/disappears, the URL changes, the " +
      "network goes idle, or a fixed delay. Conditions given together are awaited in that order. " +
      "Reports new console errors and failed requests seen while waiting.",
    promptSnippet: "Wait for an element, URL change, network idle or delay in the live page",
    parameters,
    async execute(_id, params, signal) {
      if (!params.selector && !params.urlContains && !params.networkIdle && !params.ms) {
        throw new Error("browser_wait needs at least one of selector, urlContains, networkIdle, ms");
      }
      const page = await session.getPage();
      const timeout = params.timeoutMs ?? ACTION_TIMEOUT_MS;
      const started = Date.now();
      const did: string[] = [];
      try {
        if (params.selector) {
          const state = params.state ?? "visible";
          await withAbort(page.locator(params.selector).first().waitFor({ state, timeout }), signal);
          did.push(`${params.selector} is ${state}`);
        }
        if (params.urlContains) {
          const needle = params.urlContains;
          await withAbort(page.waitForURL((u) => u.toString().includes(needle), { timeout }), signal);
          did.push(`URL contains "${needle}"`);
        }
        if (params.networkIdle) {
          await withAbort(page.waitForLoadState("networkidle", { timeout }), signal);
          did.push("network idle");
        }
        if (params.ms) {
          await withAbort(page.waitForTimeout(params.ms), signal);
          did.push(`slept ${params.ms}ms`);
        }
      } catch (e) {
        throw explain(e);
      }
      const lines = [`Waited ${Date.now() - started}ms: ${did.join("; ")}`, `Now at ${await whereAmI(page)}`];
      lines.push(...sinceSummary(session, started, page.url()));
      return textResult(lines.join("\n"), { waited: did, url: page.url() });
    },
  });
};
