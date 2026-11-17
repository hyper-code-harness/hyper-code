# Hyper Sidebar — unpacked MV3 prototype

Existing Hyper `/agent/:id?presentation=sidebar` UI inside a Chrome side panel. No replacement chat, streaming client, injected content script, remote privileged script, or debugger attachment. Root directory intentionally lives beside `mobile/`.

Live native-panel, duplicate-tab isolation, iframe message/action, navigation and CDP reconnect checks passed. See [implementation and browser test report](../docs/research/browser-sidebar-live-test.md) for evidence, 61 passing tests, and remaining limitations.

## Install and pair

1. Start Hyper (default setting: `http://localhost:3010`) and its existing CDP-enabled Chrome profile. Hyper must reach **that same Chrome instance** through its configured browser CDP endpoint. No browser restart is performed by this extension.
2. In Chrome 142+, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the absolute `browser-extension/` directory. Pin the Hyper action if useful. Chrome warns about the sensitive `debugger` permission: we call only `chrome.debugger.getTargets()`, never `attach`.
3. Open extension **Details → Extension options**. Set the actual Hyper loopback HTTP origin (localhost or 127.0.0.1, any port), then **Pair with Hyper**. A regular Hyper tab opens. Sign in to ordinary Hyper if required; review the displayed extension ID and explicitly approve. Return to options and **Check approval**.
4. Open a normal source webpage and click the extension action. Opening binds a draft only: **no agent is created or started before the first message**. The draft uses the existing Hyper composer, with the tab title (no `Browser:` prefix) and default model. The panel is disabled by default: click the extension action separately on each tab where you want it. Switching to an untouched tab hides Hyper; returning to an opted-in tab restores its own panel/chat. Chrome chooses which side hosts panels; use Chrome settings to choose the right side.
5. Submit a message using Enter or Send. Hyper creates one ordinary agent using the then-current tab title and `settings.modelDefault`, attaches the durable binding before enqueue, and opens that chat. Concurrent/retried first submits do not create or append twice. **Open in Hyper** opens this draft or the same existing agent in a full tab. The compact 30px toolbar keeps Open in Hyper, retry and settings; source/status are screen-reader-only, while errors remain visible. If iframe login/cookies block the page, open Hyper directly and sign in; restrictive cookie policies may differ.

## Per-tab opening and upgrades

Opt-in lives as `sidebar.tabs[tabId].optedIn` in `chrome.storage.session`, alongside the tab nonce and binding/chat identity. Boot, navigation, tab creation and activation never opt a tab in. Replaced tabs start disabled and do not inherit another tab's chat. Service-worker restarts restore explicit opt-ins; a full browser restart/extension reload may clear session storage. After updating from a version without `optedIn`, reopen desired tabs using the toolbar action: legacy records remain disabled, but any surviving bound chat/nonce is retained when explicitly reopened.

The global panel and automatic action behavior are disabled. The action handler issues `setOptions({tabId, enabled:true, path})` then `open({tabId})` **synchronously, without awaiting between them**; state persistence is queued before incoming panel messages. A real Chrome CDP `Extensions.triggerAction` check showed that awaiting `setOptions` first loses the user gesture and Chrome rejects `open`. Back-to-back calls successfully opened/bound the native panel. Chrome's [sidePanel documentation](https://developer.chrome.com/docs/extensions/reference/api/sidePanel) specifies gesture-only opening and automatic hiding/restoring across disabled/enabled tabs. Focused live smoke checked untouched tabs disabled, only the clicked tab enabled, native panel `document.visibilityState` changing `visible → hidden → visible` on A → untouched B → A, stable nonce on return, and the 30px native toolbar with source/status clipped to 1px screen-reader-only nodes. Worker unit tests also cover restart, legacy opt-in, close/replacement and rejected stale panel messages.

No build or npm dependencies. Test with:

```sh
cd browser-extension && bun test
```

## Identity and lifecycle

- `chrome.sidePanel.setOptions({tabId, path: 'panel.html?tabId=…&windowId=…&nonce=…'})` creates local, tab-specific identity. The panel never queries a global active tab to choose its agent. Distinct tabs at the same URL remain distinct.
- `chrome.debugger.getTargets()` maps exact `tabId` to exact page target ID; ambiguous/missing targets fail closed. Server validates against CDP. No URL/title fallback and no debugger attachment.
- `chrome.storage.session` holds a random browser epoch, per-tab nonce/agent/target, and pending close tombstones. These survive service worker suspension/reload, not a full browser restart. Persistent `chrome.storage.local` holds installation UUID, configured origin and bridge credential. The installation UUID is local metadata; the backend identity contract is pairing + browser epoch + tab ID.
- All mutations are serialized, backend binding is idempotent, intent is persisted before bind, and panel messages check tab/window/nonce. Context changes update the source/status without setting iframe `src` again for the same agent. Moving a tab configures its new window-specific panel path; stale instances require reopening.
- Tab close queues durable bridge close; when Hyper is offline, retry occurs on the next panel/tab activity or worker startup. Revocation is **not immediate while the server is unreachable**. No timer/alarm retry is claimed. Server-side target validation must fail closed independently. Replacement closes the old binding and assigns a fresh identity/agent, never transfers access. Same-tab unexpected target replacement is rejected, not silently retargeted.
- Browser restart creates a new epoch; old history remains in Hyper, but restoring the same tab-agent mapping across browser restart is not implemented. Extension update/reload may clear session storage, per Chrome behavior. Pending closures lost with full browser restart cannot be delivered by this prototype.
- Re-pairing first revokes the previous token/bindings and refuses to proceed if that server is unavailable. Settings can revoke explicitly. Credentials never enter iframe URLs, logs, page scripts or content scripts. Approved tokens currently expire after 30 days; pair approval after 10 minutes.

## API

See `../docs/research/browser-sidebar-contract.md`. Worker uses only JSON POST `/sidebar/api/{pair,status,bind,context,close,revoke}` with the narrow bridge bearer (except pair). Approval and draft submission are owner-session Hyper pages, **not** bearer-authorized. Frame URLs are reconstructed from the validated base plus a safe agent ID or UUID binding ID, never trusted as arbitrary server URLs. Draft path is `/sidebar/draft/:bindingId?presentation=sidebar`; existing chat path stays `/agent/:id?presentation=sidebar`. A mounted draft redirects itself after sending; subsequent context updates do not reload its composer. An interrupted first submission fails closed rather than automatically replaying; inspect the mapped chat or stuck binding before manual recovery.

## Security and limitations

**Trusted-user local prototype, not an agent/tool security sandbox.** Full Hyper UI has its normal powerful capabilities and independent authentication. Chrome host permissions cannot restrict ports, so the manifest permits only HTTP localhost and 127.0.0.1 hosts, while settings pin one origin. CSP allows frames and fetch only on those loopback hosts; scripts/styles remain packaged. No `<all_urls>`, remote privileged code, external-message API or `web_accessible_resources`. Two content scripts, both in every frame: `hotkeys.js` (tab hotkeys inside iframes) and `frame.js` — in a page framed directly by a Hyper page (a canvas url tab) it posts `{ hyperFrames: 1, type: "location", url, title }` to that parent after every navigation, so the tab keeps the frame's current address across re-renders and reloads (same file as `extensions/canvas-frames`; it does not lift X-Frame-Options/CSP — that stays in canvas-frames).

Unrestricted Hyper tools outside the sidebar-specific binding guard may retain ordinary trusted-user privileges. No promise of hostile-page containment, universal LLM/tool isolation, arbitrary-browser/profile support, IPv6/HTTPS loopback, or seamless restart recovery. The iframe is intentionally the real trusted Hyper UI rather than a sandboxed replacement. Cross-origin iframe load events cannot reliably diagnose login/frame blocking; use **Open in Hyper** for diagnosis.

## Manual smoke checklist

Use isolated fixture tabs in the same CDP profile. This package does not install itself or restart Chrome.

- Approve pairing; reject unapproved bridge calls. Open/reopen panels and navigate without sending: verify **zero new agents**.
- Open panels for two tabs at the same URL; verify different draft binding IDs and correct targets, with no agents until submission.
- Send through the shared composer; verify one creation even on double-submit, current tab title/default model, normal streaming/history/Stop.
- Navigate/reload the first tab; verify agent and iframe stay unchanged, source updates.
- Switch tabs and windows; ensure each panel retains its own identity. Move a tab and reopen its panel if stale.
- Suspend/restart the worker, reopen panel; verify session storage preserves mapping.
- Close a fixture tab; verify backend tombstone/access rejection and preserved chat history.
- Test tab replacement, unavailable CDP/server, revoked token and expired pair; errors must not silently create a different target/agent.
- Confirm the browser-plugin action guard uses the bound target rather than global `main`.

Automated tests cover pure configuration, identity, target mapping, URL construction, labels and manifest invariants; they do not prove Chrome sidePanel behavior or end-to-end server/browser guard correctness.
