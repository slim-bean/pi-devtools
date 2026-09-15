/**
 * Helpers shared by the browser_* tools.
 */
import {
  DEFAULT_MAX_BYTES,
  DEFAULT_MAX_LINES,
  formatSize,
  truncateHead,
  truncateTail,
} from "@earendil-works/pi-coding-agent";
import type { ExtensionAPI } from "@earendil-works/pi-coding-agent";
import type { DevtoolsSession } from "../session";

/** Every tool module exports one of these; index.ts wires them all up. */
export type ToolRegistrar = (pi: ExtensionAPI, session: DevtoolsSession) => void;

export const NAV_TIMEOUT_MS = 30_000;
export const ACTION_TIMEOUT_MS = 15_000;
/** How long interact/wait give the page to settle so the "since" summary is meaningful. */
export const SETTLE_MS = 2_000;

export type TextContent = { type: "text"; text: string };
export type ImageContent = { type: "image"; data: string; mimeType: string };

export function textResult(text: string, details: Record<string, unknown> = {}) {
  return { content: [{ type: "text", text } as TextContent], details };
}

/**
 * Cap tool output. `keep: "head"` for structured results (eval, DOM) where the
 * start matters; `"tail"` for logs where the latest entries matter.
 */
export function bounded(
  text: string,
  keep: "head" | "tail",
  maxBytes = DEFAULT_MAX_BYTES,
  maxLines = DEFAULT_MAX_LINES,
): string {
  const t = (keep === "head" ? truncateHead : truncateTail)(text, { maxBytes, maxLines });
  if (!t.truncated) return text;
  const note =
    `[truncated: showing ${t.outputLines} of ${t.totalLines} lines ` +
    `(${formatSize(t.outputBytes)} of ${formatSize(t.totalBytes)}); ` +
    `narrow the request (selector, filter, maxChars) to see more]`;
  return keep === "head" ? `${t.content}\n\n${note}` : `${note}\n\n${t.content}`;
}

/**
 * Playwright calls take timeouts, not AbortSignals. Race the promise against
 * pi's abort signal so Esc returns promptly; the browser operation itself is
 * left to hit its own timeout.
 */
export function withAbort<T>(p: Promise<T>, signal?: AbortSignal): Promise<T> {
  if (!signal) return p;
  if (signal.aborted) return Promise.reject(new Error("Cancelled"));
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new Error("Cancelled"));
    signal.addEventListener("abort", onAbort, { once: true });
    p.then(resolve, reject).finally(() => signal.removeEventListener("abort", onAbort));
  });
}

export function withTimeout<T>(p: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: NodeJS.Timeout;
  const t = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms}ms`)), ms);
  });
  return Promise.race([p, t]).finally(() => clearTimeout(timer));
}

/** Re-throw Playwright/Chrome errors with a hint the model can act on. */
export function explain(err: unknown, url?: string): Error {
  const msg = (err as Error)?.message ?? String(err);
  const first = msg.split("\n")[0];
  if (/ERR_CONNECTION_REFUSED/.test(msg)) {
    return new Error(`${first} — nothing is listening at ${url ?? "that address"}. Is the dev server running?`);
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) {
    return new Error(`${first} — DNS lookup failed for ${url ?? "that host"}.`);
  }
  if (/strict mode violation/i.test(msg)) {
    // Playwright already lists the matching elements; keep that, drop the call-log noise.
    return new Error(msg.split("\nCall log")[0]);
  }
  if (/Timeout .* exceeded/.test(first) || /timed out/i.test(first)) {
    return new Error(msg.split("\nCall log")[0]);
  }
  return err instanceof Error ? err : new Error(msg);
}
