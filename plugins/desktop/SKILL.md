---
name: desktop
description: "Control the local macOS desktop like a user: list apps and windows, read any native app's UI as an Accessibility tree, press buttons and menu items, fill fields, click, type, press shortcuts, scroll and take screenshots with OCR. Use when a task needs a native Mac app (Calculator, Notes, Finder, System Settings, Mail, Numbers, …) that has no API or plugin. For Chrome pages prefer the browser plugin."
---

# Desktop (macOS)

A small Swift helper (`script/desktop-helper.swift`, compiled automatically into `.build/` on first call) talks to the macOS Accessibility API and CGEvent. The server process needs **Accessibility** and **Screen Recording** permissions — check with `desktop.check({})`, `desktop.check({ prompt: true })` opens the system dialogs.

## Loop: look → act → look again

1. `desktop.apps({})` / `desktop.activate({ app })` — find or launch the app (name, bundle id or pid).
2. `desktop.snapshot({ app })` — outline of the focused window: `id Role "label" = value [actions]`. Roots: `f` focused window, `w0..` windows, `m` menu bar, `a` whole app, or any id for a subtree. `desktop.find({ app, query, role? })` jumps straight to matching elements.
3. Act on ids:
   - `desktop.press({ app, id, action? })` — AX action (Press, Pick, ShowMenu, Increment, Confirm…). No mouse movement, works on background windows. **Preferred.**
   - `desktop.setValue({ app, id, value })` — replace text of a field directly.
   - `desktop.click({ id | x,y, button?, count? })` — real mouse click; `desktop.type({ text })` (Unicode, any layout); `desktop.key({ keys: ["cmd+s", "return"] })`; `desktop.scroll({ dy, x?, y? })`. These go to the frontmost app, so `activate` first.
4. Snapshot again: ids are child-index paths and go stale after the UI changes.

`desktop.screenshot({ app?, region?, ocr: true })` saves a PNG (read the path to see it, downscaled to 1600 px) and with `ocr` returns text lines with centers in **screen points**, ready for `desktop.click({ x, y })`. Use it for web views, canvas and Electron apps whose tree is poor, and to verify results.

## Notes

- Coordinates everywhere are screen points, top-left origin (Retina pixels / scale).
- Menus: `snapshot({ root: "m", maxDepth: 1 })`, then `press({ id: "m.2", action: "Press" })` to open and snapshot `m.2` for its items — or just use `key` shortcuts.
- Mouse/keyboard actions use the user's real pointer and focus; element actions (`press`, `setValue`) do not.
- `key` uses US key positions; single characters without a key code (`*`, `+`, `ё`) are typed as Unicode.
- Tested (macOS 27): Calculator via press and key, TextEdit via type/setValue/cmd shortcuts, menu bar, window screenshot + OCR.
