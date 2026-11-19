import assert from "node:assert/strict";
import { test } from "node:test";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DevtoolsSession } from "../src/session";
import { enumValue } from "../src/enum";
import { registerInteract } from "../src/tools/interact";
import { registerNavigate } from "../src/tools/navigate";
import { registerTabs } from "../src/tools/tabs";
import { registerWait } from "../src/tools/wait";

test("enum narrowing accepts only exact strings, not coercible objects", () => {
  const values = ["click", "fill"] as const;
  for (const value of values) assert.equal(enumValue(value, values, "action"), value);
  for (const value of [undefined, null, {}, ["click"], 1, "CLICK", "delete"])
    assert.throws(() => enumValue(value, values, "action"), /Invalid action/);
});

test("invalid browser enums fail before attaching or mutating a page", async () => {
  const tools = new Map<string, { execute: (...args: any[]) => Promise<unknown> }>();
  const pi = { registerTool(tool: any) { tools.set(tool.name, tool); } } as unknown as ExtensionAPI;
  let attaches = 0;
  const session = {
    async getPage() { attaches++; throw new Error("unexpected attach"); },
    async listPages() { attaches++; throw new Error("unexpected attach"); },
  } as unknown as DevtoolsSession;
  for (const register of [registerInteract, registerNavigate, registerTabs, registerWait]) register(pi, session);
  const cases = [
    ["browser_interact", { action: "delete", selector: "#fixture" }, "action"],
    ["browser_tabs", { action: "delete" }, "action"],
    ["browser_navigate", { url: "https://fixture.example/", waitUntil: "forever" }, "waitUntil"],
    ["browser_wait", { selector: "#fixture", state: "gone" }, "state"],
  ] as const;
  for (const [name, params, field] of cases)
    await assert.rejects(tools.get(name)!.execute("test", params), new RegExp(`Invalid ${field}`));
  assert.equal(attaches, 0);
});
