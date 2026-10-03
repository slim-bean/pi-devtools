# pi-devtools

Use a **live Chrome** from [pi](https://github.com/earendil-works/pi): browse and
research, work with authenticated websites, interact with pages, inspect DOM/state,
take screenshots, and debug local apps with console/network diagnostics.

One tab persists across tool calls, so SPA routes, form input and logins carry
over, and every navigate/click/wait result ends with *what just broke*:

```
Done: click text=Save
Now at http://localhost:3000/items — "Items"
Console: 1 error(s), 0 warning(s) — see browser_console
  • TypeError: Cannot read properties of undefined (reading 'id')
Network: 1 failed request(s) — see browser_network
  • POST /api/items → 500
```

## Why not web_fetch?

[pi-search](https://github.com/slim-bean/pi-search)'s `web_fetch` (and its
`browser` proxy, [browser-fetch](https://github.com/slim-bean/browser-fetch))
is built for one-shot page reading in pooled worker tabs, paced per host, with
private/loopback targets refused by default. Interactive work needs a persistent
tab and interaction/state inspection. Both attach to the same Chrome and share
cookies, but never automatically adopt each other's tabs. With pi-search loaded,
`browser_read` extracts Markdown from this extension's current tab without fetching
again; use `browser_dom` for app controls or content article extraction omits.

## Install

Requires Node ≥ 22 and Google Chrome (or Chromium).

```bash
pi install git:github.com/slim-bean/pi-devtools
```

Or, to hack on it, clone and install the working tree instead:

```bash
git clone https://github.com/slim-bean/pi-devtools ~/projects/pi-devtools
cd ~/projects/pi-devtools && npm install
pi install ~/projects/pi-devtools
```

Then start Chrome with remote debugging, either from pi:

```
/devtools launch                # optional: /devtools launch http://localhost:3000
```

or from a shell (same thing, stays up after pi exits):

```bash
scripts/chrome-launch.sh [url]
```

That opens a **headed** Chrome with a dedicated profile
(`~/.local/share/pi-devtools/chrome-profile`) and DevTools on
`127.0.0.1:9222`. You can watch the agent, log into your app by hand, or open
Chrome's own DevTools in the same window. The extension attaches lazily on the
first tool call. After a restart or tab loss, state-dependent operations report the
reset; navigate or deliberately select a tab to reconstruct the task. No actions
are replayed.

Already running browser-fetch's Chrome on `:9222`? Nothing to launch; it just
attaches.

## Tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Open a URL (`localhost:3000` is fine). Returns status, timing, and new errors/failed requests. |
| `browser_tabs` | List, select, open or close tabs without changing desktop focus. Prefer stable `id` over shifting `index`. Explicit `focus` brings a tab forward for human handoff. |
| `browser_console` | Console messages and uncaught exceptions since last read, with source locations. |
| `browser_network` | Requests since last read. Failed API/document calls include request and response bodies. |
| `browser_eval` | Run JS in the page (`await` and `return` allowed); JSON result. |
| `browser_dom` | Accessibility tree (default), native text/HTML, or an open-shadow DOM outline (`mode: "shadow"`). |
| `browser_screenshot` | Viewport, full page, or one element, returned as an image; optionally saved to a file. |
| `browser_interact` | click / dblclick / fill / type / press / hover / check / uncheck / select. Reports what changed. |
| `browser_wait` | Wait for a selector state, URL change, network idle, or delay. |

Selectors are Playwright selectors: CSS, `text=Sign in`,
`role=button[name="Save"]`, `[data-testid=x]`, `xpath=…`.
`browser_dom` (aria mode) is the intended way to find them. A snapshot entry
`button "Reload"` maps to `role=button[name="Reload"]`, **not** necessarily
`button:has-text("Reload")`: roles need not be HTML tags, and an icon-only control
can have an accessible name without containing that text.

CSS, role, and text selectors already pierce **open** shadow roots. XPath and
native `document.querySelector()` in `browser_eval` do not; closed roots are
unsupported. An empty query is not evidence of a closed root.

For component internals, use `browser_dom` with `mode: "shadow"` and an optional
`selector`. It returns an indented structural outline with `#shadow-root (open)`
markers, attributes, and text—not valid HTML or visibility-filtered/composed text.
Light DOM and shadow children appear once each; slot assignments are not expanded.
Closed roots and iframe documents are not entered; script/style/template contents
are omitted. Per match, traversal is capped at 5,000 nodes, depth 40, and 50,000
characters (or a smaller `maxChars`); long values/attribute lists are abbreviated.
Native `text`/`html` modes are unchanged and warn that they may omit shadow content.

Interaction timeouts retain a bounded Playwright diagnostic excerpt (missing,
hidden, disabled, or intercepted target) and relevant selector hints. They never
retry a different target. `browser_interact.value` is only accepted for
fill/type/press/select; other actions reject it, including coordinate-like values.

## Command

```
/devtools                # status: attached? Chrome reachable? which tab?
/devtools launch [url]   # start Chrome via scripts/chrome-launch.sh
/devtools disconnect     # detach; Chrome keeps running
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PI_DEVTOOLS_CDP_URL` | `http://127.0.0.1:9222` | DevTools endpoint to attach to; supports a gateway prefix such as `http://browser:8377/cdp` |
| `PI_DEVTOOLS_CDP_TOKEN` | unset | Bearer token for both HTTP discovery and WebSocket connection |
| `PI_DEVTOOLS_CDP_TOKEN_FILE` | unset | Read the bearer token from this file instead of the token env var |
| `PI_DEVTOOLS_PROFILE` | `~/.local/share/pi-devtools/chrome-profile` | Profile dir used by the launcher |
| `PI_DEVTOOLS_DEBUG_PORT` | `9222` | Port used by the launcher (keep in sync with the URL) |
| `CHROME_BIN` | auto-detected | Chrome binary for the launcher |
| `PI_DEVTOOLS_AUTO_LAUNCH` | off | `1` automatically launches a managed local Chrome on first use; verifies profile/browser identity before attaching |
| `PI_DEVTOOLS_BACKGROUND` | off | `1` launches without a startup window and creates the first window minimized; macOS also uses `open -g -n` (app-bundle Chrome required) |

### Shared assistant browser

```bash
PI_DEVTOOLS_AUTO_LAUNCH=1 \
PI_DEVTOOLS_BACKGROUND=1 \
PI_DEVTOOLS_CDP_URL=http://127.0.0.1:19322 \
PI_DEVTOOLS_PROFILE="$HOME/.local/share/pi-assistant/chrome-profile" pi
```

Managed startup uses a cross-process heartbeat lock and Chrome's announced websocket
identity. It refuses unrelated listeners instead of adopting whichever browser owns
a port. Local launch requires `http://127.0.0.1:<port>`. The runtime identity and
latest startup log live at `<profile>/.pi-devtools-runtime.json` and `.pi-chrome.log`.
A stale launcher lock can take about a minute to expire.

Each pi session creates its own background tabs; an existing blank tab might belong
to another conversation or fetch worker. All tabs share the default profile's
cookies. Browser tools execute sequentially within a tool batch. User-requested
selection of another tab is explicit, but isn't a cross-process ownership lock:
multiple agents deliberately selecting the same tab can still interfere. IDs last
only for the current Chrome run. There is no persisted tab mapping or restoration.

Background mode uses `--no-startup-window`, then creates the first window minimized;
macOS additionally uses `open -g -n`. The OS launch flag alone is insufficient—Chrome
can otherwise activate its startup window. Tab creation uses CDP's `background: true`
on all platforms. `browser_tabs focus` explicitly restores/foregrounds a window.
Background launch takes no initial URL; navigate after attaching. Native desktop
focus behavior on other platforms is window-manager dependent.

### External/container browsers

```bash
PI_DEVTOOLS_CDP_URL=http://browser-fetch.browser-test.svc.cluster.local:8377/cdp
PI_DEVTOOLS_CDP_TOKEN_FILE=/run/secrets/browser-fetch/token
PI_DEVTOOLS_AUTO_LAUNCH=0
```

The gateway must proxy both discovery and WebSockets and rewrite advertised debugger
URLs to its reachable address (browser-fetch's optional `/cdp/` does this). Token
files take precedence and are read on each connection/probe. Remote mode attaches
only: the browser host owns Chrome and its profile. A lost connection never causes
a local replacement to launch with auto-launch disabled. The same tab isolation,
state-loss errors and current-tab snapshot API work remotely. Localhost URLs refer
to the browser's host, not the machine running pi.

### Extension integration

Versioned `pi.events` request channels (responders assign `request.result` synchronously):

- `pi-devtools:capabilities:v1`: `{result?: {managedStop: boolean}}` advertises
  managed shutdown support (`managedStop: true`).
- `pi-devtools:runtime:v1`: `{operation: "ensure" | "status" | "focus" | "stop", result?: Promise<unknown>}`.
  `ensure` launches only when managed auto-launch is enabled, otherwise requires
  an existing reachable endpoint. `status` only probes and validates managed identity;
  `focus` explicitly restores/foregrounds the current (or a new) interactive tab.
  `stop` requires managed auto-launch and a loopback endpoint, verifies the profile's
  browser identity, then sends CDP `Browser.close` to that exact browser run. It shares
  the launch lock and waits for the debug port/profile lock to clear. It never launches,
  kills a cached PID, or force-kills; attach-only/external mode is rejected. The result
  is `true` if stopped, `false` if already absent. This affects **all** clients and loses
  tabs; the next use may relaunch. Coordinators must explicitly authorize shared shutdown.
  pi-assistant exposes this as local-only `/assistant stop`; session shutdown still only
  disconnects.
- `pi-devtools:snapshot:v1`: `{result?: Promise<{html, url, title}>}` reads the current
  tab without navigation. Caller should register a sequential tool (as `browser_read`
  does). A missing `result` means this extension/version isn't loaded.

Only trusted extensions may use these channels. Factories open no connections.
[pi-assistant](../pi-assistant/README.md) coordinates these settings with browser-fetch,
pi-search's browser-only mode, and pi-browser's history roots.

## Security

Anything that can reach the DevTools port can drive the browser, including
whatever you are logged into in that profile. The launcher binds it to
loopback only. `browser_eval` runs arbitrary JavaScript in the page; treat the
dedicated profile as the agent's identity, not yours.

## Development

```bash
npm run typecheck   # against the globally installed pi's real types
npm run smoke       # launches/attaches Chrome, checks capabilities plus DOM/interaction regressions
npm run smoke:dom   # same DOM regressions in disposable headless Chrome; never touches shared tabs
pi -e ./src/index.ts -p "Use browser_navigate on https://example.com, then browser_dom. Then stop."
```

See `AGENTS.md` for layout and conventions.
