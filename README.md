# pi-devtools

Drive a **live, local Chrome** from [pi](https://github.com/earendil-works/pi-mono):
open the app you are building, click around, read the console and network log,
run JavaScript against page state, take screenshots. A browser debug loop for
the agent, on the real thing.

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
is built to *read* the web: one-shot, stateless, paced per host, and it
refuses private/loopback targets. Debugging needs the opposite: a stateful tab,
localhost, console and network introspection, and interaction. So this is a
separate extension. Both can attach to the same Chrome.

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
first tool call and reconnects if Chrome restarts.

Already running browser-fetch's Chrome on `:9222`? Nothing to launch; it just
attaches.

## Tools

| Tool | What it does |
|---|---|
| `browser_navigate` | Open a URL (`localhost:3000` is fine). Returns status, timing, and new errors/failed requests. |
| `browser_tabs` | List tabs, drive one the user already has open, open a new one, close one. |
| `browser_console` | Console messages and uncaught exceptions since last read, with source locations. |
| `browser_network` | Requests since last read. Failed API/document calls include request and response bodies. |
| `browser_eval` | Run JS in the page (`await` and `return` allowed); JSON result. |
| `browser_dom` | Accessibility tree (default), text, or HTML of the page or a selector. |
| `browser_screenshot` | Viewport, full page, or one element, returned as an image; optionally saved to a file. |
| `browser_interact` | click / dblclick / fill / type / press / hover / check / uncheck / select. Reports what changed. |
| `browser_wait` | Wait for a selector state, URL change, network idle, or delay. |

Selectors are Playwright selectors: CSS, `text=Sign in`,
`role=button[name="Save"]`, `[data-testid=x]`, `xpath=…`.
`browser_dom` (aria mode) is the intended way to find them.

## Command

```
/devtools                # status: attached? Chrome reachable? which tab?
/devtools launch [url]   # start Chrome via scripts/chrome-launch.sh
/devtools disconnect     # detach; Chrome keeps running
```

## Configuration

| Variable | Default | Purpose |
|---|---|---|
| `PI_DEVTOOLS_CDP_URL` | `http://127.0.0.1:9222` | DevTools endpoint to attach to |
| `PI_DEVTOOLS_PROFILE` | `~/.local/share/pi-devtools/chrome-profile` | Profile dir used by the launcher |
| `PI_DEVTOOLS_DEBUG_PORT` | `9222` | Port used by the launcher (keep in sync with the URL) |
| `CHROME_BIN` | auto-detected | Chrome binary for the launcher |

## Security

Anything that can reach the DevTools port can drive the browser, including
whatever you are logged into in that profile. The launcher binds it to
loopback only. `browser_eval` runs arbitrary JavaScript in the page; treat the
dedicated profile as the agent's identity, not yours.

## Development

```bash
npm run typecheck   # against the globally installed pi's real types
npm run smoke       # launches/attaches Chrome, serves a deliberately broken app, checks every capability
pi -e ./src/index.ts -p "Use browser_navigate on https://example.com, then browser_dom. Then stop."
```

See `AGENTS.md` for layout and conventions.
