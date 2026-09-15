/**
 * Renders session buffers as compact text for the model.
 */
import type { Page } from "playwright-core";
import { isFailure, type ConsoleEntry, type DevtoolsSession, type NetworkEntry } from "./session";

const ERROR_LEVELS = new Set(["error", "pageerror", "assert"]);
const WARN_LEVELS = new Set(["warning", "warn"]);

export function isErrorLevel(level: string): boolean {
  return ERROR_LEVELS.has(level);
}

export function isWarnLevel(level: string): boolean {
  return WARN_LEVELS.has(level);
}

function clock(ts: number): string {
  const d = new Date(ts);
  const p = (n: number, w = 2) => String(n).padStart(w, "0");
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}.${p(d.getMilliseconds(), 3)}`;
}

/** Drop the origin when it matches the page, so lines stay short. */
export function shortUrl(url: string, pageUrl?: string): string {
  if (!pageUrl) return url;
  try {
    const origin = new URL(pageUrl).origin;
    return url.startsWith(origin) ? url.slice(origin.length) || "/" : url;
  } catch {
    return url;
  }
}

export function formatConsole(entries: ConsoleEntry[]): string {
  if (entries.length === 0) return "No console output.";
  const errors = entries.filter((e) => isErrorLevel(e.level)).length;
  const warnings = entries.filter((e) => isWarnLevel(e.level)).length;
  const lines = [`${entries.length} console message(s): ${errors} error(s), ${warnings} warning(s)`, ""];
  for (const e of entries) {
    const level = e.level === "pageerror" ? "error" : e.level;
    const loc = e.location ? `  (${e.location})` : "";
    lines.push(`[${clock(e.ts)}] ${level.padEnd(7)} ${e.text}${loc}`);
  }
  return lines.join("\n");
}

export function formatNetwork(entries: NetworkEntry[], pageUrl?: string, bodies = true): string {
  if (entries.length === 0) return "No network requests.";
  const failures = entries.filter(isFailure).length;
  const pending = entries.filter((e) => !e.done).length;
  const lines = [
    `${entries.length} request(s): ${failures} failed, ${pending} pending`,
    "",
    `${"METHOD".padEnd(6)} ${"STATUS".padEnd(6)} ${"TIME".padStart(7)}  ${"TYPE".padEnd(10)} URL`,
  ];
  for (const e of entries) {
    const status = e.failure ? "FAIL" : e.status !== undefined ? String(e.status) : e.done ? "-" : "…";
    const time = e.durationMs !== undefined ? `${e.durationMs}ms` : "";
    lines.push(
      `${e.method.padEnd(6)} ${status.padEnd(6)} ${time.padStart(7)}  ${e.resourceType.padEnd(10)} ${shortUrl(e.url, pageUrl)}`,
    );
    if (e.failure) lines.push(`       ↳ ${e.failure}`);
    if (bodies && e.requestBody) lines.push(`       ↳ request body: ${oneLine(e.requestBody)}`);
    if (bodies && e.responseBody) lines.push(`       ↳ response body: ${oneLine(e.responseBody)}`);
  }
  return lines.join("\n");
}

function oneLine(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

/**
 * "What changed since `sinceTs`" — appended to navigate/interact/wait results
 * so the model learns about new errors without a separate call.
 */
export function sinceSummary(session: DevtoolsSession, sinceTs: number, pageUrl?: string): string[] {
  const out: string[] = [];
  const con = session.console(sinceTs);
  const errors = con.filter((e) => isErrorLevel(e.level));
  const warnings = con.filter((e) => isWarnLevel(e.level)).length;
  if (errors.length || warnings) {
    out.push(`Console: ${errors.length} error(s), ${warnings} warning(s) — see browser_console`);
    for (const e of errors.slice(0, 3)) out.push(`  • ${oneLine(e.text).slice(0, 200)}`);
    if (errors.length > 3) out.push(`  • … ${errors.length - 3} more`);
  }
  const net = session.network(sinceTs);
  const failed = net.filter(isFailure);
  if (failed.length) {
    out.push(`Network: ${failed.length} failed request(s) — see browser_network`);
    for (const e of failed.slice(0, 5)) {
      const status = e.failure ?? String(e.status);
      out.push(`  • ${e.method} ${shortUrl(e.url, pageUrl)} → ${status}`);
    }
    if (failed.length > 5) out.push(`  • … ${failed.length - 5} more`);
  }
  return out;
}

/** "Now at <url> — <title>" header line for results. */
export async function whereAmI(page: Page): Promise<string> {
  const title = await page.title().catch(() => "");
  return title ? `${page.url()} — "${title}"` : page.url();
}

/** Accept "localhost:3000" and "example.com/x"; dev servers are the common case. */
export function normalizeUrl(input: string): string {
  const s = input.trim();
  if (/^[a-z][a-z0-9+.-]*:/i.test(s)) return s; // has a scheme (http, https, file, about, data…)
  return `http://${s}`;
}
