#!/usr/bin/env bash
# Launch the Chrome that pi-devtools attaches to.
#
# Headed on purpose: you can watch what the agent does, log into your app by
# hand, and open DevTools yourself in the same window. The profile is dedicated
# so the agent's identity stays separate from your personal browsing.
#
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

if curl -fsS --max-time 1 "http://127.0.0.1:${PORT}/json/version" >/dev/null 2>&1; then
  echo "Chrome DevTools already listening on 127.0.0.1:${PORT}; nothing to do." >&2
  exit 0
fi

mkdir -p "$PROFILE"

# DevTools bound to loopback only: anyone who can reach this port can drive the
# browser, including anything you have logged into in this profile.
exec "$CHROME" \
  --user-data-dir="$PROFILE" \
  --remote-debugging-port="$PORT" \
  --remote-debugging-address=127.0.0.1 \
  --no-first-run \
  --no-default-browser-check \
  --disable-features=Translate \
  --restore-last-session=false \
  "${@:-about:blank}"
