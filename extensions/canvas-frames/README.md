# Hyper canvas frames

Chrome extension that lets the canvas `url` tab show sites that forbid framing (Google, GitHub, …).

Inside a Hyper tab only, it removes `X-Frame-Options` and `Content-Security-Policy` from frame responses
(declarativeNetRequest session rule per tab). The page gets `data-hyper-frames` on `<html>`, and the canvas
then frames such sites instead of showing the "open in a new tab" notice.

Install: chrome://extensions → Developer mode → Load unpacked → this folder. Every Hyper instance also
serves it as a zip at `/canvas/framesExtension.zip` (the canvas url tab links there when the extension is
missing): download, unzip, Load unpacked → the `hyper-canvas-frames` folder.

The address bar follows the site: `frame.js` (in frames directly inside a Hyper page) reports each new
address; the tab keeps it in its state, so a reload opens the same page.

Logins inside the frame work: a framed site is cross-site to Hyper, so Chrome would drop its
`SameSite=Lax`/`Strict` session cookies (e.g. Aidbox: "CSRF protection. No ssid cookie"). For frames in Hyper
tabs the worker stores each such `Set-Cookie` again as `SameSite=None; Secure` (`cookies.js`, tested by
`bun test ./extensions/canvas-frames`). Only https sites and localhost/127.0.0.1 (which Chrome treats as
secure) qualify.

Limits: sites that check `window.top` in JavaScript can still refuse.
