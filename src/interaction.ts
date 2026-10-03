import type { Page } from "playwright-core";

export const ACTIONS = ["click", "dblclick", "fill", "type", "press", "hover", "check", "uncheck", "select"] as const;
export type Action = (typeof ACTIONS)[number];
const NEEDS_VALUE = new Set<Action>(["fill", "type", "press", "select"]);

/** Validate before attaching to Chrome: never silently ignore unsupported arguments. */
export function validateInteraction(action: Action, selector: string | undefined, value: string | undefined): void {
  if (NEEDS_VALUE.has(action)) {
    if (value === undefined) throw new Error(`${action} requires a value`);
  } else if (value !== undefined) {
    throw new Error(`${action} does not accept value. Use a selector; coordinate clicks are not supported.`);
  }
  if (action !== "press" && !selector) throw new Error(`${action} needs a selector`);
}

export async function performInteraction(
  page: Page, action: Action, selector: string | undefined, value: string | undefined, timeout: number,
): Promise<void> {
  validateInteraction(action, selector, value);
  if (action === "press" && !selector) {
    await page.keyboard.press(value!);
    return;
  }
  const el = page.locator(selector!);
  switch (action) {
    case "click": return el.click({ timeout });
    case "dblclick": return el.dblclick({ timeout });
    case "hover": return el.hover({ timeout });
    case "check": return el.check({ timeout });
    case "uncheck": return el.uncheck({ timeout });
    case "fill": return el.fill(value!, { timeout });
    case "type": return el.pressSequentially(value!, { timeout });
    case "press": return el.press(value!, { timeout });
    case "select": return el.selectOption(value!, { timeout }).then(() => undefined);
  }
}
