/**
 * Start (or find) the Chrome that the session attaches to.
 *
 * Chrome is started detached via scripts/chrome-launch.sh so it outlives the
 * pi process: the profile, logins and open tabs are the user's, not ours.
 */
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cdpUrl } from "./session";

export const LAUNCH_SCRIPT = fileURLToPath(new URL("../scripts/chrome-launch.sh", import.meta.url));

export interface DevtoolsVersion {
  browser: string;
  webSocketDebuggerUrl?: string;
}

/** GET /json/version — the cheapest "is Chrome there" probe. */
export async function probe(timeoutMs = 1_000): Promise<DevtoolsVersion | null> {
  try {
    const res = await fetch(`${cdpUrl()}/json/version`, { signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const v = (await res.json()) as { Browser?: string; webSocketDebuggerUrl?: string };
    return { browser: v.Browser ?? "unknown", webSocketDebuggerUrl: v.webSocketDebuggerUrl };
  } catch {
    return null;
  }
}

/**
 * Launch Chrome through the script and wait for DevTools to answer.
 * Returns the version string, or throws with the script's stderr.
 */
export async function launchChrome(args: string[] = [], waitMs = 15_000): Promise<string> {
  const already = await probe();
  if (already) return already.browser;

  const port = (() => {
    try {
      return new URL(cdpUrl()).port || "9222";
    } catch {
      return "9222";
    }
  })();

  const child = spawn(LAUNCH_SCRIPT, args, {
    detached: true,
    stdio: ["ignore", "ignore", "pipe"],
    env: { ...process.env, PI_DEVTOOLS_DEBUG_PORT: process.env.PI_DEVTOOLS_DEBUG_PORT ?? port },
  });
  let stderr = "";
  child.stderr?.on("data", (d: Buffer) => (stderr += d.toString()));
  child.on("error", (e) => (stderr += e.message));
  child.unref();

  const deadline = Date.now() + waitMs;
  while (Date.now() < deadline) {
    const v = await probe(500);
    if (v) {
      child.stderr?.destroy();
      return v.browser;
    }
    if (child.exitCode !== null && child.exitCode !== 0) break;
    await new Promise((r) => setTimeout(r, 250));
  }
  throw new Error(
    `Chrome did not answer at ${cdpUrl()} within ${waitMs}ms.` + (stderr.trim() ? `\n${stderr.trim()}` : ""),
  );
}
