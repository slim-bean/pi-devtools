/** Lazy, detached Chrome launch. Managed mode never adopts an unknown CDP listener. */
import { spawn } from "node:child_process";
import { mkdir, readFile, writeFile, rename, open, lstat } from "node:fs/promises";
import { chromium } from "playwright-core";
import { connect } from "node:net";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import lockfile from "proper-lockfile";
import { autoLaunch, cdpUrl, cdpHeaders, profileDir } from "./config";

export const LAUNCH_SCRIPT = fileURLToPath(new URL("../scripts/chrome-launch.sh", import.meta.url));
export interface DevtoolsVersion { browser: string; webSocketDebuggerUrl?: string }
interface Identity { endpoint: string; websocket: string; profile: string; pid: number }

export async function probe(timeoutMs = 1_000, endpoint = cdpUrl()): Promise<DevtoolsVersion | null> {
  try {
    const res = await fetch(`${endpoint}/json/version`, { headers: cdpHeaders(), redirect: "error", signal: AbortSignal.timeout(timeoutMs) });
    if (!res.ok) return null;
    const v = await res.json() as { Browser?: string; webSocketDebuggerUrl?: string };
    return { browser: v.Browser ?? "unknown", webSocketDebuggerUrl: v.webSocketDebuggerUrl };
  } catch { return null; }
}

function occupied(port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = connect({ host: "127.0.0.1", port });
    const done = (yes: boolean) => { socket.destroy(); resolve(yes); };
    socket.once("connect", () => done(true));
    socket.once("error", () => done(false));
    socket.setTimeout(1_000, () => done(true));
  });
}

export async function verifyIdentity(version: DevtoolsVersion, profile = profileDir(), endpoint = cdpUrl()): Promise<void> {
  let identity: Identity | undefined;
  try { identity = JSON.parse(await readFile(join(profile, ".pi-devtools-runtime.json"), "utf8")); } catch { /* unknown */ }
  if (!identity || !version.webSocketDebuggerUrl || identity.websocket !== version.webSocketDebuggerUrl ||
      identity.endpoint !== endpoint || identity.profile !== profile) {
    throw new Error(`Refusing to attach: ${endpoint} is not the managed Chrome for ${profile}. ` +
      "Choose a free debug port or close the conflicting instance; your other browser will not be touched.");
  }
}

/** Integration readiness: attach-only unless managed auto-launch was opted into. */
export async function ensureRuntime(): Promise<DevtoolsVersion> {
  if (autoLaunch()) await launchChrome();
  const version = await probe();
  if (!version) throw new Error(`Chrome at ${cdpUrl()} is unavailable or authentication failed. In attach-only mode its lifecycle belongs to the external host.`);
  return version;
}

/** Explicit managed shutdown only. Never launch, signal a cached PID, or touch attach-only browsers. */
export async function stopChrome(): Promise<boolean> {
  if (!autoLaunch()) throw new Error("Stopping Chrome requires local managed mode; external browsers belong to their host.");
  const endpoint = cdpUrl();
  const profile = profileDir();
  const url = new URL(endpoint);
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/") {
    throw new Error("Stopping Chrome requires a local loopback CDP endpoint.");
  }
  try { await lstat(profile); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
    if (await occupied(Number(url.port))) throw new Error("Cannot verify Chrome for shutdown: the debug port is occupied.");
    return false;
  }
  const release = await lockfile.lock(profile, {
    stale: 60_000, update: 10_000, retries: { retries: 150, minTimeout: 500, maxTimeout: 500 },
  });
  try {
    const version = await probe(1_000, endpoint);
    if (!version) {
      if (await occupied(Number(url.port))) throw new Error("Cannot verify Chrome for shutdown: the debug port is occupied.");
      return false;
    }
    await verifyIdentity(version, profile, endpoint);
    // Connect to the verified, run-specific WebSocket, not a newly discovered browser.
    // The recorded launch PID may be macOS's `open`, not Chrome itself.
    const browser = await chromium.connectOverCDP(version.webSocketDebuggerUrl!, { timeout: 5_000 });
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        (async () => {
          const cdp = await browser.newBrowserCDPSession();
          // Chrome can disconnect before acknowledging Browser.close. Verify exit below.
          await cdp.send("Browser.close").catch(() => {});
        })(),
        new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error("Chrome shutdown request timed out.")), 5_000); }),
      ]);
    } finally {
      clearTimeout(timer);
      await browser.close(); // detach only; Browser.close above is the actual shutdown
    }
    const deadline = Date.now() + 15_000;
    while (Date.now() < deadline) {
      let profileLocked = true;
      try { await lstat(join(profile, "SingletonLock")); }
      catch (error) { if ((error as NodeJS.ErrnoException).code === "ENOENT") profileLocked = false; else throw error; }
      if (!profileLocked && !(await occupied(Number(url.port)))) return true;
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    throw new Error("Chrome did not finish shutting down; no force-kill was attempted.");
  } finally { await release(); }
}

/** With auto-launch enabled this validates identity even when Chrome is already running. */
export async function ensureChrome(): Promise<void> {
  if (autoLaunch()) await launchChrome();
}

export async function launchChrome(args: string[] = [], waitMs = 20_000): Promise<string> {
  const managed = autoLaunch();
  const endpoint = cdpUrl();
  const profile = profileDir();
  const url = new URL(endpoint);
  const launchEnv = { ...process.env, PI_DEVTOOLS_PROFILE: profile, PI_DEVTOOLS_DEBUG_PORT: url.port,
    PI_DEVTOOLS_MANAGED_LAUNCH: "1" };
  const already = await probe(1_000, endpoint);
  if (already && !managed) return already.browser;
  if (url.protocol !== "http:" || url.hostname !== "127.0.0.1" || !url.port || url.pathname !== "/") {
    throw new Error("Automatic/local launch requires PI_DEVTOOLS_CDP_URL=http://127.0.0.1:<port>. Remote browsers must be started on their host.");
  }
  await mkdir(profile, { recursive: true, mode: 0o700 });
  // All pi processes sharing this profile coordinate here. Heartbeats permit slow starts;
  // a dead launcher's lock expires, without killing any running Chrome.
  const release = await lockfile.lock(profile, {
    stale: 60_000, update: 10_000,
    retries: { retries: 150, minTimeout: 500, maxTimeout: 500 },
  });
  try {
    const other = await probe(1_000, endpoint);
    if (other) {
      if (managed) await verifyIdentity(other, profile, endpoint);
      return other.browser;
    }
    if (await occupied(Number(url.port))) throw new Error(`Debug port ${url.port} is occupied by an unrecognized service.`);
    const logPath = join(profile, ".pi-chrome.log");
    const log = await open(logPath, "w", 0o600);
    const logOffset = (await log.stat()).size;
    const child = spawn(LAUNCH_SCRIPT, args, {
      detached: true, stdio: ["ignore", log.fd, log.fd],
      env: launchEnv,
    });
    let spawnError: Error | undefined;
    child.on("error", (e) => { spawnError = e; });
    child.unref();
    await log.close();
    const deadline = Date.now() + waitMs;
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError;
      if (child.exitCode !== null || child.signalCode !== null) break;
      const v = await probe(500, endpoint);
      let announced = false;
      if (v?.webSocketDebuggerUrl) {
        // Bind the responding endpoint to THIS launch, not just a listener that
        // raced us for the port. Chrome announces its unique websocket on stderr.
        const output = await open(logPath, "r");
        try {
          const buffer = Buffer.alloc(64 * 1024);
          const { bytesRead } = await output.read(buffer, 0, buffer.length, logOffset);
          announced = buffer.subarray(0, bytesRead).toString().includes(`DevTools listening on ${v.webSocketDebuggerUrl}`);
        } finally { await output.close(); }
      }
      if (v?.webSocketDebuggerUrl && announced) {
        const identity: Identity = { endpoint, websocket: v.webSocketDebuggerUrl, profile, pid: child.pid! };
        const file = join(profile, ".pi-devtools-runtime.json");
        await writeFile(`${file}.${process.pid}.tmp`, JSON.stringify(identity), { mode: 0o600 });
        await rename(`${file}.${process.pid}.tmp`, file);
        return v.browser;
      }
      await new Promise((r) => setTimeout(r, 150));
    }
    throw new Error(`Chrome did not become ready at ${endpoint}. See ${join(profile, ".pi-chrome.log")}.`);
  } finally { await release(); }
}
