/** Isolated DOM/interaction regressions; never attaches to or modifies shared Chrome. */
import { chromium } from "playwright-core";
import { checkDOM } from "./dom-checks";

const browser = await chromium.launch({
  ...(process.env.CHROME_BIN ? { executablePath: process.env.CHROME_BIN } : { channel: "chrome" }),
  headless: true,
});
try {
  await checkDOM(await browser.newPage());
  console.log("\nall DOM checks passed");
} finally {
  await browser.close();
}
