import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { formatNetwork } from "../format";
import { isFailure, type NetworkEntry } from "../session";
import { bounded, textResult, type ToolRegistrar } from "./shared";

const API_TYPES = new Set(["xhr", "fetch", "eventsource", "websocket", "document"]);

const parameters = Type.Object({
  kind: Type.Optional(
    StringEnum(["api", "all"] as const, {
      description:
        "api (default): fetch/XHR/EventSource/WebSocket and document requests. all: also scripts, " +
        "styles, images, fonts. Failed requests of any kind are always included.",
    }),
  ),
  onlyFailures: Type.Optional(
    Type.Boolean({ description: "Only requests that failed or returned HTTP >= 400 (default false)." }),
  ),
  urlContains: Type.Optional(Type.String({ description: "Only requests whose URL contains this substring." })),
  clear: Type.Optional(
    Type.Boolean({
      description: "Clear completed requests after reading so the next call shows only new ones (default true).",
    }),
  ),
});

export const registerNetwork: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_network",
    label: "Browser Network",
    description:
      "Requests made by the current tab, buffered since the tab was adopted or last cleared: method, " +
      "status, duration, type and URL. Failed API/document requests include the request and response " +
      "bodies (capped), which is usually where the actual error message is. Reads clear the buffer by default.",
    promptSnippet: "List network requests (with failures and their bodies) from the live page",
    parameters,
    async execute(_id, params) {
      const page = await session.getPage();
      const all = session.network();
      const kind = params.kind ?? "api";
      const needle = params.urlContains;

      const keep = (e: NetworkEntry): boolean => {
        if (needle && !e.url.includes(needle)) return false;
        if (params.onlyFailures && !isFailure(e)) return false;
        if (kind === "api" && !API_TYPES.has(e.resourceType) && !isFailure(e)) return false;
        return true;
      };
      const entries = all.filter(keep);
      if (params.clear !== false) session.clearNetwork();

      let text = formatNetwork(entries, page.url());
      if (entries.length === 0 && all.length > 0) {
        text = `No matching requests (${all.length} other request(s) were buffered${params.clear !== false ? " and cleared" : ""}). Try kind: "all" or drop the filters.`;
      }
      return textResult(bounded(text, "tail"), {
        count: entries.length,
        failed: entries.filter(isFailure).length,
        total: all.length,
      });
    },
  });
};
