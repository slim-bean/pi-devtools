/**
 * Page-level helpers that depend only on Playwright (no pi imports), so they
 * can be exercised from scripts/smoke.ts and unit tests.
 */
import type { Page } from "playwright-core";

/**
 * Accept both `1 + 1` and `const x = …; return x;`. Try the expression form
 * first; if the page reports a SyntaxError, re-run as a statement body.
 */
export async function evalInPage(page: Page, code: string): Promise<unknown> {
  try {
    return await page.evaluate(`(async () => (${code}\n))()`);
  } catch (e) {
    if (!/SyntaxError/.test((e as Error).message)) throw e;
  }
  return page.evaluate(`(async () => {${code}\n})()`);
}
