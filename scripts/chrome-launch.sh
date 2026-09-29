#!/usr/bin/env bash
# Launch the Chrome that pi-devtools attaches to.
#
# Headed on purpose: you can watch what the agent does, log into your app by
# hand, and open DevTools yourself in the same window. The profile is dedicated
# so the agent's identity stays separate from your personal browsing.
#
# PI_DEVTOOLS_BACKGROUND=1 uses macOS LaunchServices' non-activating launch.
# Chrome 136+ refuses --remote-debugging-port on the default profile directory,
# so a dedicated --user-data-dir is required.
#
# Environment:
#   PI_DEVTOOLS_PROFILE     profile dir   (default ~/.local/share/pi-devtools/chrome-profile)
#   PI_DEVTOOLS_DEBUG_PORT  DevTools port (default 9222; PI_DEVTOOLS_CDP_URL must match)
#   CHROME_BIN              Chrome binary (auto-detected if unset)
#
# Extra arguments are passed to Chrome, e.g. an initial URL:
#   scripts/chrome-launch.sh http://localhost:3000
set -euo pipefail

PROFILE="${PI_DEVTOOLS_PROFILE:-$HOME/.local/share/pi-devtools/chrome-profile}"
PORT="${PI_DEVTOOLS_DEBUG_PORT:-9222}"
CHROME="${CHROME_BIN:-}"

if [[ -z "$CHROME" ]]; then
  for candidate in \
    "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
    "/Applications/Chromium.app/Contents/MacOS/Chromium" \
    google-chrome google-chrome-stable chromium chromium-browser; do
    if [[ -x "$candidate" ]] || command -v "$candidate" >/dev/null 2>&1; then
      CHROME="$candidate"
      break
    fi
  done
fi
[[ -n "$CHROME" ]] || { echo "no Chrome found; set CHROME_BIN" >&2; exit 1; }

if [[ "${PI_DEVTOOLS_MANAGED_LAUNCH:-}" != 1 ]] && curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "Chrome DevTools already listening on 127.0.0.1:${PORT}; nothing to do." >&2
  exit 0
fi

mkdir -p "$PROFILE"

# DevTools bound to loopback only: anyone who can reach this port can drive the
# browser, including anything you have logged into in this profile.
args=(
  --user-data-dir="$PROFILE"
  --remote-debugging-port="$PORT"
  --remote-debugging-address=127.0.0.1
  --no-first-run
  --no-default-browser-check
  --disable-features=Translate
)
if [[ "${PI_DEVTOOLS_BACKGROUND:-}" == 1 ]]; then
  [[ $# == 0 ]] || { echo "background launch takes no initial URL; navigate after attaching" >&2; exit 1; }
  args+=(--no-startup-window)
else
  args+=("${@:-about:blank}")
fi
if [[ "${PI_DEVTOOLS_BACKGROUND:-}" == 1 && "$(uname -s)" == Darwin ]]; then
  APP="${CHROME%/Contents/MacOS/*}"
  [[ "$APP" != "$CHROME" && -d "$APP" ]] || { echo "background launch requires CHROME_BIN inside a macOS .app bundle" >&2; exit 1; }
  # -g suppresses activation at launch (not a race-prone switch-focus-back).
  # -n isolates this profile from the user's existing Chrome; -W keeps the
  # launcher alive for diagnostics. Explicit output files preserve CDP identity.
  exec /usr/bin/open -g -n -W -a "$APP" \
    --stdout "$PROFILE/.pi-chrome.log" --stderr "$PROFILE/.pi-chrome.log" --args "${args[@]}"
fi
exec "$CHROME" "${args[@]}"
