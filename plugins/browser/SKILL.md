---
name: browser
description: "Browser automation over Chrome DevTools Protocol (CDP) on :9222. Use to inspect and navigate named tabs, capture compact accessibility or readable-content snapshots, interact with pages, run Google workflows, take screenshots in the user's real Chrome, and hand a tab to a human through a live-view link (CAPTCHA, 2FA, sign-in)."
---

# browser

Drives the user's real Chrome through CDP. Chrome must expose a debugging endpoint at `CDP_BROWSER_URL` (default `http://127.0.0.1:9222`). The plugin attaches to existing tabs or creates named background tabs and keeps connection handles in runtime state.

## Starting Chrome

The plugin attaches to a running Chrome; it does not assume one exists. Bring it
up through the plugin rather than by hand:

```sh
hyper repl 'await ctx.fns.chrome.ensure({})'          # start only if none answers
hyper repl 'await ctx.fns.chrome.ensure({ noStart: true })'  # health check, never launches
hyper repl 'await ctx.fns.chrome.start({})'           # force a fresh launch
hyper repl 'await ctx.fns.chrome.profileDir({})'      # which profile would be used
```

**The profile is the point.** Chrome must open the directory that holds the
logged-in sessions — the Google accounts, UpToDate, Ramp, everything the
plugins reach through the browser. Starting on the wrong one looks exactly like
"everything logged itself out". `chrome.profileDir` resolves it in this order:

1. `CDP_USER_DATA_DIR` if set;
2. `~/.hyper/browser/chrome-profile` — the Hyper-owned location;
3. `~/uniskill/skills/browser/chrome-profile` — where the real ~3.7 GB of
   sessions still lives after the uniskill migration, reported as `legacy: true`.

Moving that directory into the Hyper-owned path is a deliberate step (copy it
while Chrome is closed, then verify a login), not something the plugin does on
its own.

**Why a separate instance.** A Chrome already running on the default profile
cannot be given a debugging port after the fact — the flag only applies at
launch. So `chrome.start` opens its own instance on the profile above, and your
everyday Chrome keeps running untouched.

**Why tmux.** Chrome is launched inside a detached tmux session (`chrome-cdp`,
override with `CDP_TMUX_SESSION`) instead of as a child of the runtime. A child
shares the server's process group, so every Hyper restart would close the
browser and drop the sessions the profile exists to keep.

| variable | meaning | default |
|---|---|---|
| `CDP_BROWSER_URL` | endpoint the plugin talks to; its port is what Chrome opens | `http://127.0.0.1:9222` |
| `CDP_USER_DATA_DIR` | user-data directory | resolved as above |
| `CDP_PROFILE` | profile directory inside it | `Profile 1` |
| `CDP_LOAD_EXTENSION` | unpacked extension, `""` to disable | bundled `arc-sidebar` when present |
| `CDP_TMUX_SESSION` | session Chrome runs in | `chrome-cdp` |
| `CHROME_BIN` | Chrome binary | platform default |

## Live view: hand a tab to a human

`browser.liveView({ tab })` returns `{ url }` — a page of this Hyper that shows one Chrome tab and lets a
person click, type, scroll and switch tabs in it. Give that link to the human when the page needs a
person, not the agent:

- a CAPTCHA, "are you human" check or bot wall;
- a two-factor prompt, SMS/app code, passkey or security question;
- signing in, re-entering a password, choosing an account, consent that requires the account owner;
- anything the user must confirm personally (payment, sending, deleting).

Then stop driving that tab: say what you need the person to do, wait for them to tell you they are done,
and only then continue (`browser.snapshot` first — the page has changed). `browser.liveViewStatus({})`
shows whether a viewer is connected; `browser.liveViewStop({})` disconnects viewers when the hand-off is
over or the link must be revoked.

```ts
const { url } = await ctx.fns.browser.liveView({ tab: "main" });     // named session or targetId
await ctx.fns.browser.liveView({});                                  // the most recent page
await ctx.fns.browser.liveView({ tab, cdp: "http://127.0.0.1:9230" }); // another Chrome, if allowed
```

How it works: `/browser/live` (page) and `/browser/live/socket` (`$ws_` WebSocket route) are ordinary
Hyper routes behind the same sign-in. Per viewer the socket opens its own CDP connection, attaches to
the target, enables `Emulation.setFocusEmulationEnabled` (so a background tab keeps painting) and starts
`Page.startScreencast`; the JPEG frames go to the viewer unchanged, the viewer's every pointer move,
button, wheel and key comes back as `Input.dispatchMouseEvent` / `Input.dispatchKeyEvent` /
`Input.insertText` — real, `isTrusted` input with the human's own timing. Nothing is injected into or
evaluated in the page (no `Runtime.evaluate`, no `addScriptToEvaluateOnNewDocument`), which matters on
profiles watched by anti-bot checks. Paste in the viewer and the "Insert text" button type text through
`Input.insertText`; copying out of the page is not supported.

Why not VNC: an RFB server plus noVNC was the first plan and was dropped. noVNC translates keysyms back to
DOM keys and re-frames JPEG tiles; a web viewer already has DOM `key`/`code`, coalesced pointer events and
the clipboard, and Chrome already produces JPEG frames, so the page draws `Page.screencastFrame` on a canvas
and sends DOM input back as `Input.*` — the same approach as Browserless, Steel and the DevTools screencast.
Manual probes and an isolated test Chrome (CDP 9230) are in `probes/` (`probe-screencast.ts`: a background
tab sends no frames without focus emulation; `probe-bg-scroll.ts`: wheel input and frames keep working).

| setting / env | meaning | default |
|---|---|---|
| `CDP_BROWSER_URL` | Chrome shown by default — the same one every `browser.*` function drives | `http://127.0.0.1:9222` |
| `browser.liveCdpAllow` / `BROWSER_LIVE_CDP_ALLOW` | other endpoints a link may name with `?cdp=` (comma-separated) | none |
| `browser.liveQuality` / `BROWSER_LIVE_QUALITY` | JPEG quality 10–100 | 70 |
| `BROWSER_LIVE_BASE_URL` | public base of links (e.g. the Hyperlet address) | tailnet HTTPS when reachable, else `http://localhost:<port>` |

Limits: one tab at a time per viewer (switch in the toolbar); the picture is the tab's viewport, not
browser UI (no permission prompts, file pickers or extension popups); native `<select>` popups and
`alert()` dialogs render outside the page and are not visible.

## Observe before acting

Use `browser.snapshot` as the observation primitive:

- `interactive` returns a compact accessibility view with revision-scoped refs such as `@r2e7`.
- `text` returns visible text; set `readable: true` to prefer article/main content.
- `markdown` and `html` return cleaned readable content.
- `a11y` returns the broader accessibility tree.
- `sinceRevision` requests an explicit change summary against an earlier snapshot from the same session.

Snapshot refs are scoped to one logical session and document revision. Capture a new interactive snapshot after navigation or when an action reports `STALE_REF`. Prefer refs when available; CSS and visible-text targets are strict fallbacks and fail on multiple visible matches instead of choosing the first.

## Choose the precise interaction

Use the focused browser functions for ordinary work:

- `browser.click` for one actionable target. The legacy CSS `selector` option remains supported.
- `browser.fill` to replace one or several plain form values without submitting. Batching the fields of one form reduces tool calls and stops at the first failure.
- `browser.type` for autocomplete, rich editors and applications that require actual CDP text input. Use `clear: true` to replace existing text; prefer this over `fill` when suggestions must appear.
- `browser.press` for keys and combinations. `Tab` and `Shift+Tab` include deterministic focus traversal fallback when Chrome does not move focus itself.
- `browser.select` for native select options by exact value or visible label.
- `browser.check` to set checkbox/radio state idempotently, including visually hidden native controls used by styled widgets.
- `browser.hover` and `browser.scroll` for pointer and viewport interactions.

`browser.act` exposes the same engine for an ordered advanced batch. Batches are fail-fast and return successful partial results plus a structured failed step. Keep batches short: refs or page state can become stale between unrelated actions, and explicit observe/verify calls are easier to diagnose.

Targets use one locator:

```ts
{ ref: "r2e7" }
{ css: "#destination" }
{ text: "Search", exact: true }
```

Actions auto-wait for attachment, visibility and actionability. Target ambiguity, stale refs, hidden/disabled controls and partial failures are surfaced explicitly. Filling and typing never submit a form by themselves.

## Sessions, cleanup and low-level access

Named sessions default to `main`. High-level Google workflows use task-specific sessions, and multi-page research uses independently named page sessions. Task-created tabs should normally be closed with the tab/session cleanup functions. High-level workflows clean up temporary sessions unless callers intentionally request `keepOpen`.

Prefer the high-level Google search, AI and research workflows for those tasks rather than scraping Google manually. AI-generated answers can be wrong; compare factual claims with source pages. Consent pages, login challenges and CAPTCHA are reported as errors rather than silently returning empty results.

All CDP capabilities remain public. Use `browser.evaluate`, `cdp.send` or `cdp.session` when the focused browser operations do not expose a required Chrome capability. This plugin connects to an existing debuggable Chrome; it does not launch the browser.
