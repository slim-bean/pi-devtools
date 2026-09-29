import { readFileSync } from "node:fs";
import { homedir } from "node:os";
import { resolve } from "node:path";

export function cdpHeaders(): Record<string, string> {
  const file = process.env.PI_DEVTOOLS_CDP_TOKEN_FILE?.trim();
  const token = (file ? readFileSync(file, "utf8") : process.env.PI_DEVTOOLS_CDP_TOKEN)?.trim();
  if (token && /[\r\n]/.test(token)) throw new Error("CDP token contains an embedded newline");
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export const DEFAULT_CDP_URL = "http://127.0.0.1:9222";
export function cdpUrl(): string {
  return (process.env.PI_DEVTOOLS_CDP_URL?.trim() || DEFAULT_CDP_URL).replace(/\/+$/, "");
}
export function profileDir(): string {
  const path = process.env.PI_DEVTOOLS_PROFILE?.trim() || "~/.local/share/pi-devtools/chrome-profile";
  return resolve(path.replace(/^~(?=\/|$)/, homedir()));
}
/** Auto-launch also requires a verified, managed browser identity. */
export function autoLaunch(): boolean {
  return /^(1|true|yes)$/i.test(process.env.PI_DEVTOOLS_AUTO_LAUNCH ?? "");
}
