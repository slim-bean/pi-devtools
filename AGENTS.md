# AGENTS.md

pi-devtools is a pi extension that drives a live, user-launched Chrome over CDP
(via `playwright-core`'s `connectOverCDP`) and exposes `browser_*` tools for
debugging web apps under development. See `README.md` for user docs.

## Layout

- `src/index.ts` — entry point. Creates one `DevtoolsSession`, registers all
  tools and the `/devtools` command, closes the session on `session_shutdown`.
  Must not open sockets at load time (pi may load extensions in runs that never
  start a session).
- `src/session.ts` — `DevtoolsSession`: lazy connect/reconnect to
  `PI_DEVTOOLS_CDP_URL`, the single driven `Page` (adopts an idle `about:blank`
  tab or opens one; re-opens if the user closes it), and bounded ring buffers
  of `ConsoleEntry` / `NetworkEntry` for that page. `console(sinceTs)` /
  `network(sinceTs)` peek; `clearConsole()` / `clearNetwork()` drain. Bodies
  are captured only for failed xhr/fetch/document requests (capped 2KB).
  Also `safeStringify`, `clip`, `isFailure`, `cdpUrl`.
- `src/page.ts` — Playwright-only helpers (`evalInPage`: expression first,
  statement-body fallback on SyntaxError). No pi imports, so scripts can use it.
- `src/format.ts` — LLM-facing rendering: `formatConsole`, `formatNetwork`,
  `sinceSummary` (the "what changed since ts" block appended to
  navigate/interact/wait results), `whereAmI`, `normalizeUrl`, `shortUrl`.
- `src/launch.ts` — `probe()` (`GET /json/version`) and `launchChrome()`
  (detached spawn of `scripts/chrome-launch.sh`, then poll until DevTools answers).
- `src/command.ts` — `/devtools [status|launch [url]|disconnect]`.
- `src/tools/` — one tool per file, each exporting a `ToolRegistrar`
  (`(pi, session) => void`); `index.ts` lists them in system-prompt order.
  `shared.ts` has `textResult`, `bounded` (truncation with a note), `withAbort`
  (race Playwright promises against pi's abort signal), `withTimeout`,
  `explain` (rewrite Chrome/Playwright errors with an actionable hint), and
  the timeout constants.
- `scripts/chrome-launch.sh` — headed Chrome, dedicated profile, DevTools on
  loopback. No-ops if the port already answers.
- `scripts/typecheck.sh` — generates a temporary tsconfig whose `paths` point
  at the globally installed pi, so peers resolve to real types without bundling.
- `scripts/smoke.ts` — no-LLM end-to-end check against a local server that
  500s, 404s and throws on purpose.

## Conventions

- Attach, never launch, from tool code. Chrome is the user's; the launcher is a
  convenience. `browser.close()` on a connected browser only disconnects.
- One driven tab. `browser_tabs use` switches it; switching resets the buffers.
  Never close the last tab (Chrome would exit).
- Every state-changing tool (navigate, interact, wait) records `started =
  Date.now()` and appends `sinceSummary(session, started, page.url())` so the
  model learns about new errors without a follow-up call. Interact settles with
  `waitForLoadState("networkidle", { timeout: SETTLE_MS })` and swallows the timeout.
- Reads (`browser_console`, `browser_network`) clear by default (`clear:
  false` to peek). `browser_network` defaults to `kind: "api"` but always
  includes failures of any resource type, so the summary counts and the listing agree.
- Throw from `execute` on failure (pi marks the result as an error); route
  Playwright errors through `explain()` first. Race long Playwright calls with
  `withAbort(signal)` so Esc returns promptly.
- Use `StringEnum` from `@earendil-works/pi-ai` for enums (Google compatibility).
  `promptGuidelines` bullets must name the tool they refer to.
- Bound all output: `bounded(text, "head")` for structured results,
  `"tail"` for logs. Screenshots go through pi's `resizeImage` (≤1568px, ≤3MB)
  and are captured at `scale: "css"` so retina displays don't quadruple the bytes.
- Keep `src/page.ts` and `src/session.ts` free of pi imports so `scripts/`
  can run them under `tsx` without pi's jiti aliases.

## Testing

```bash
npm run typecheck            # must print "typecheck ok"
npm run smoke                # must print "all checks passed" and exit 0
pi -e ./src/index.ts -p "Use browser_navigate to open https://example.com, then browser_dom with mode aria, then stop."
```

`npm run smoke` launches Chrome if `:9222` is silent, uses a dedicated tab and
closes it. Useful manual fixtures: a `data:text/html,…` URL with an inline
`onclick` that `console.error`s (interact → summary → console), any dev server
on localhost (navigate + network bodies), a page with duplicate buttons (strict
mode error message from `browser_interact`).

Chrome ≥ 136 refuses `--remote-debugging-port` on the default profile; the
launcher's dedicated `--user-data-dir` is required, not optional.
