import { StringEnum } from "@earendil-works/pi-ai";
import { Type } from "typebox";
import { formatConsole, isErrorLevel, isWarnLevel } from "../format";
import { bounded, textResult, type ToolRegistrar } from "./shared";

const LEVELS = ["all", "error", "warning", "info", "log", "debug"] as const;

const parameters = Type.Object({
  level: Type.Optional(
    StringEnum(LEVELS, {
      description: "Only show this level (default all). 'error' includes uncaught exceptions.",
    }),
  ),
  clear: Type.Optional(
    Type.Boolean({
      description: "Clear the buffer after reading so the next call shows only new output (default true).",
    }),
  ),
});

export const registerConsole: ToolRegistrar = (pi, session) => {
  pi.registerTool({
    name: "browser_console",
    label: "Browser Console",
    description:
      "Console output and uncaught exceptions from the current tab, buffered since the tab was adopted " +
      "or last cleared. Each line has a timestamp, level, message and source location. Reads clear the " +
      "buffer by default, so successive calls answer 'what was logged since I last looked'.",
    promptSnippet: "Read console messages and uncaught errors from the live page",
    parameters,
    async execute(_id, params) {
      // Ensure we are attached; otherwise there is nothing buffered to report.
      await session.getPage();
      const all = session.console();
      const level = params.level ?? "all";
      const entries = all.filter((e) => {
        if (level === "all") return true;
        if (level === "error") return isErrorLevel(e.level);
        if (level === "warning") return isWarnLevel(e.level);
        return e.level === level;
      });
      if (params.clear !== false) session.clearConsole();

      let text = formatConsole(entries);
      if (entries.length === 0 && all.length > 0) {
        text = `No ${level} messages (${all.length} other message(s) were buffered${params.clear !== false ? " and cleared" : ""}).`;
      }
      return textResult(bounded(text, "tail"), { count: entries.length, total: all.length });
    },
  });
};
