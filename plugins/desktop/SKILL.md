---
name: desktop
description: "Control macOS desktops like a user — this Mac or any Mac reachable over SSH: list apps and windows, look at a window (Accessibility outline with clickable indexes + screenshot + OCR), click, type, press keys, scroll and fill fields in the background without stealing the pointer. Built on Cua Driver (trycua/cua). Use when a task needs a native or Electron app (Calculator, Notes, Finder, System Settings, Discord, Slack, Figma…) that has no API or plugin. For Chrome pages prefer the browser plugin."
---

# Desktop (macOS, local or over SSH)

Backend: [Cua Driver](https://github.com/trycua/cua) — `/Applications/CuaDriver.app` holds the Accessibility and Screen Recording grants; `~/.local/bin/cua-driver mcp` is spoken over one persistent connection per host (`ssh <host>` for remote Macs, nothing else to install there). Every function takes `host` (an alias from `remote.servers`, omit for this Mac).

## Loop: look → act → look

1. `desktop.windows({ host })` / `desktop.apps({ host })` — what is open. `desktop.open({ host, app })` launches or un-hides a window (needed for minimized/hidden ones).
2. `desktop.look({ host, app, ocr? , query? })` → `outline` (`[index] Role "label" [actions]`), `image` (read the path to see it), `ocr` lines with `x,y` in screenshot pixels.
3. Act — each accepts **element** (index from the last look), **text** (label, resolved via Accessibility, then OCR) or **x/y** (screenshot pixels):
   - `desktop.click({ host, app, text: "Send" })` (button right, count 2, foreground for stubborn apps)
   - `desktop.type({ host, app, value, text?: "Message" })`, `desktop.key({ host, app, key: "return" | "cmd+k" })`
   - `desktop.scroll({ host, app, direction: "down", amount? })`, `desktop.setValue({ host, app, element, value })`
   Actions return a fresh screenshot by default (`after`: none | tree | screenshot | both).
4. Look again; element indexes are replaced by each look of that window.

Anything else (drag, zoom, invoke_menu, clipboard, window frames, recording): `desktop.tools({ name? })` then `desktop.call({ host, tool, args })`.

## Setup per Mac

- Install: `curl -fsSL https://cua.ai/driver/install.sh | bash -s -- --no-modify-path` then `~/.local/bin/cua-driver telemetry disable` (telemetry is on by default).
- Grant: `cua-driver permissions grant`, approve CuaDriver in Privacy & Security → Accessibility and Screen Recording (someone at the Mac or via Screen Sharing).
- `desktop.check({ host })` verifies; on `permissions_pending` or stale grants use `desktop.check({ host, fix: true })` (restarts the daemon via `permissions grant`).
- `desktop.check({ host, fast: true })` restarts the daemon with a 250 ms post-action window watch (default 1 s): clicks and keys drop from ~1.2 s to ~0.4 s.

## Notes

- Background delivery: no pointer movement, no focus steal; covered windows work, minimized/hidden ones need `open` first.
- Electron apps (Discord, Slack) expose some labelled elements; otherwise `look({ ocr: true })` + `click({ x, y })` or `click({ text })`.
- Labels differ by state/version (Calculator shows "All Clear" or "Clear"); look before guessing.
- Measured (M-series, Tailscale SSH): look tree ~0.2 s, screenshot ~0.4 s, OCR +2 s, fast-mode click ~0.4-1.5 s.
