import assert from "node:assert/strict";
import type { Page } from "playwright-core";
import { inspectShadowDOM } from "../src/dom";
import { explain } from "../src/errors";
import { ACTIONS, performInteraction, validateInteraction } from "../src/interaction";

/** Shared by the CDP smoke run and a disposable headless Chrome run. Replaces page content. */
export async function checkDOM(page: Page): Promise<void> {
  await page.goto("about:blank");
  await page.setContent('<outer-host></outer-host><closed-host></closed-host>');
  await page.evaluate(() => {
    const outer = document.querySelector("outer-host")!.attachShadow({ mode: "open" });
    outer.innerHTML = '<inner-host><span slot="label">Slotted label</span></inner-host>';
    const inner = outer.querySelector("inner-host")!.attachShadow({ mode: "open" });
    inner.innerHTML = '<div role="button" tabindex="0" aria-label="Reload">↻</div>' +
      '<div role="switch" tabindex="0" aria-label="Developer mode" aria-checked="false">⚙</div>' +
      '<button>Visible text</button><slot name="label"></slot>';
    inner.querySelector('[role="button"]')!.addEventListener("click", () => document.body.dataset.clicked = "yes");
    inner.querySelector('[role="switch"]')!.addEventListener("click", (event) => {
      (event.currentTarget as Element).setAttribute("aria-checked", "true");
    });
    document.querySelector("closed-host")!.attachShadow({ mode: "closed" }).innerHTML = '<button>Closed secret</button>';
    customElements.define("read-check", class extends HTMLElement {
      constructor() {
        super();
        document.body.dataset.constructions = String(Number(document.body.dataset.constructions ?? 0) + 1);
      }
    });
    inner.append(document.createElement("read-check"));
  });

  const body = page.locator("body");
  const aria = await body.ariaSnapshot();
  assert.match(aria, /button "Reload"/);
  assert.match(aria, /switch "Developer mode"/);
  assert.equal(await page.locator('button:has-text("Reload")').count(), 0);
  assert.equal(await page.locator("text=Reload").count(), 0);
  assert.equal(await page.locator('role=button[name="Reload"]').count(), 1);
  assert.equal(await page.locator("text=Visible text").count(), 1);
  assert.equal(await page.locator('xpath=//button').count(), 0);
  assert.equal(await page.evaluate(() => document.querySelector('[aria-label="Reload"]')), null);
  assert.equal(await body.innerText(), "");
  assert.doesNotMatch(await body.evaluate(e => e.outerHTML), /aria-label="Reload"/);
  console.log("ok   roles/text pierce open shadow roots; native queries, XPath and outerHTML do not");

  const outline = await inspectShadowDOM(body, 20_000, 2000);
  assert.equal(outline.match(/#shadow-root \(open\)/g)?.length, 2);
  assert.match(outline, /<div role="button" tabindex="0" aria-label="Reload">/);
  assert.match(outline, /Visible text/);
  assert.equal(outline.match(/Slotted label/g)?.length, 1);
  assert.doesNotMatch(outline, /Closed secret/);
  assert.equal(await body.getAttribute("data-constructions"), "1", "inspection must not clone custom elements");
  const scoped = await inspectShadowDOM(page.locator('role=button[name="Reload"]'), 1000, 2000);
  assert.match(scoped, /aria-label="Reload"/);
  assert.doesNotMatch(scoped, /Developer mode/);
  const short = await inspectShadowDOM(body, 80, 2000);
  assert.match(short, /shadow outline truncated/);
  assert.ok(short.length < 250);
  console.log("ok   shadow outline is scoped, read-only, bounded and does not duplicate slot content");

  await performInteraction(page, "click", 'role=button[name="Reload"]', undefined, 2000);
  assert.equal(await body.getAttribute("data-clicked"), "yes");
  await performInteraction(page, "click", 'role=switch[name="Developer mode"]', undefined, 2000);
  assert.equal(await page.locator('role=switch[name="Developer mode"]').getAttribute("aria-checked"), "true");

  for (const action of ACTIONS) {
    if (["fill", "type", "press", "select"].includes(action)) {
      assert.throws(() => validateInteraction(action, "body", undefined), /requires a value/);
      assert.doesNotThrow(() => validateInteraction(action, "body", ""));
    } else {
      assert.throws(() => validateInteraction(action, "body", "Mouse.click at x=970, y=18"), /does not accept value/);
      assert.doesNotThrow(() => validateInteraction(action, "body", undefined));
    }
    if (action !== "press") assert.throws(() => validateInteraction(action, undefined, ""), /needs a selector|does not accept value/);
  }
  assert.doesNotThrow(() => validateInteraction("press", undefined, "Escape"));
  await page.evaluate(() => { document.body.dataset.clicked = "no"; });
  await assert.rejects(performInteraction(page, "click", 'role=button[name="Reload"]', "ignored?", 500), /does not accept value/);
  assert.equal(await body.getAttribute("data-clicked"), "no", "invalid arguments must not dispatch a click");
  console.log("ok   custom button/switch interactions work; ignored values rejected without dispatching");

  async function failure(selector: string): Promise<string> {
    try {
      await performInteraction(page, "click", selector, undefined, 400);
    } catch (err) {
      return explain(err, undefined, selector).message;
    }
    throw new Error(`Expected click failure: ${selector}`);
  }
  const missing = await failure("text=Reload");
  assert.match(missing, /waiting for locator/);
  assert.match(missing, /accessible names/);
  assert.match(missing, /role=button\[name="Reload"\]/);
  assert.equal(await body.getAttribute("data-clicked"), "no", "failure hints must not retry a different selector");
  assert.match(await failure("xpath=//button"), /XPath does not pierce/);
  await page.setContent('<button id="hidden" style="display:none">Hidden</button>' +
    '<button id="disabled" disabled>Disabled</button>' +
    '<div style="position:relative;width:200px;height:60px">' +
    '<button id="covered" style="width:100%;height:100%">Covered</button>' +
    '<div style="position:absolute;inset:0">Overlay</div></div>' +
    '<button>Duplicate</button><button>Duplicate</button>');
  assert.match(await failure("#hidden"), /not visible/);
  assert.match(await failure("#disabled"), /not enabled/);
  assert.match(await failure("#covered"), /intercepts pointer events/);
  const strict = await failure('role=button[name="Duplicate"]');
  assert.match(strict, /strict mode violation/);
  assert.match(strict, /resolved to 2 elements/);
  const huge = explain(new Error("locator.click: Timeout 400ms exceeded.\nCall log:\n" +
    Array.from({ length: 1000 }, (_, i) => `observation ${i}: ${"x".repeat(500)}`).join("\n")));
  assert.ok(huge.message.length < 3100);
  assert.match(huge.message, /diagnostics truncated/);
  assert.match(explain(new Error("net::ERR_CONNECTION_REFUSED"), "http://localhost").message, /nothing is listening at http:\/\/localhost/);
  console.log("ok   timeout diagnostics retain missing/hidden/disabled/overlay evidence and stay bounded");

  await page.setContent('<div id="deep"></div><div id="wide"></div><div id="escaped" title="&quot;&lt;&amp;">&lt;tag&gt;</div>');
  await page.evaluate(() => {
    let parent = document.querySelector("#deep")!;
    for (let i = 0; i < 60; i++) parent = parent.appendChild(document.createElement("div"));
    const wide = document.querySelector("#wide")!;
    for (let i = 0; i < 5500; i++) wide.appendChild(document.createComment("ignored"));
  });
  assert.match(await inspectShadowDOM(page.locator("#deep"), 50_000, 2000), /depth limit/);
  assert.match(await inspectShadowDOM(page.locator("#wide"), 50_000, 2000), /shadow outline truncated/);
  assert.match(await inspectShadowDOM(page.locator("#escaped"), 2000, 2000), /title="\\"<&"/);
  console.log("ok   shadow traversal bounds depth and node visits, and quotes attributes");
}
