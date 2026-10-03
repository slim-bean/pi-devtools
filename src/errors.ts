/** Playwright error rendering without pi imports, shared by tools and smoke checks. */
function diagnosticExcerpt(message: string): string {
  // Preserve the first observations (match, visibility, interception, etc.) without
  // flooding the model with Playwright's repeated retry log.
  const lines = message.split("\n");
  const seen = new Set<string>();
  const unique = lines.filter((line) => {
    const key = line.trim().replace(/^\d+ × /, "");
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  const excerpt = unique.slice(0, 24).join("\n");
  return excerpt.length > 3000 || unique.length > 24
    ? `${excerpt.slice(0, 3000)}\n[diagnostics truncated]`
    : excerpt;
}

/** Re-throw Playwright/Chrome errors with evidence and an actionable hint. Never retry an action. */
export function explain(err: unknown, url?: string, selector?: string): Error {
  const msg = (err as Error)?.message ?? String(err);
  const first = msg.split("\n")[0];
  if (/ERR_CONNECTION_REFUSED/.test(msg)) {
    return new Error(`${first} — nothing is listening at ${url ?? "that address"}. Is the dev server running?`);
  }
  if (/ERR_NAME_NOT_RESOLVED/.test(msg)) {
    return new Error(`${first} — DNS lookup failed for ${url ?? "that host"}.`);
  }
  if (/strict mode violation/i.test(msg)) {
    return new Error(diagnosticExcerpt(msg.split("\nCall log")[0]));
  }
  if (/Timeout .* exceeded/.test(first) || /timed out/i.test(first)) {
    let hint = "";
    if (selector && /text\s*=|:has-text\(|:text(?:-is|-matches)?\(/.test(selector)) {
      hint = '\nHint: text selectors match text content, not accessible names. Use browser_dom mode aria; ' +
        'button "Reload" maps to role=button[name="Reload"]. Playwright locators already pierce open shadow roots.';
    } else if (selector && /^(?:xpath=|\/\/|\.\.\/)/.test(selector)) {
      hint = "\nHint: XPath does not pierce shadow roots. Use browser_dom mode aria and a role or CSS selector for open shadow DOM.";
    }
    return new Error(diagnosticExcerpt(msg) + hint);
  }
  return err instanceof Error ? err : new Error(msg);
}
