// The live-view bridge for one viewer: a browser-level CDP socket with a flat
// session on the shown page. Chrome's screencast JPEGs go to the viewer as they
// are (no re-encoding), the viewer's mouse and keys come back as Input.* events.
// Nothing is evaluated in, or injected into, the page: only Target.*, Page.*
// navigation/screencast, Input.* and Emulation.setFocusEmulationEnabled (so a
// background tab keeps painting) are used.

type Viewer = { send: (data: string | Uint8Array) => number; getBufferedAmount: () => number; close: (code?: number, reason?: string) => void };
type Target = { targetId: string; type: string; title: string; url: string; attached?: boolean };

const MAX_BUFFERED = 1 << 20;
// Auto quality: look at dropped frames every WINDOW_MS; drop a level when frames
// were dropped, climb one back after CALM_WINDOWS calm windows in a row.
const WINDOW_MS = 2000;
const CALM_WINDOWS = 3;
// Health: every HEALTH_MS one cheap browser-level call measures Chrome's answer time
// and the result goes to the viewer, so "live" means Chrome answers, not just that
// the socket to Hyper is open (a static page sends no frames at all).
const HEALTH_MS = 3000;
const HEALTH_TIMEOUT_MS = 4000;
// Window fitting: wait for the viewer's resize to settle, ignore changes under FIT_STEP CSS px.
const FIT_DELAY_MS = 250;
const FIT_STEP = 16;

/**
 * Opens the CDP side of one live-view viewer and returns a handle that bridges it to the viewer socket.
 *
 * Use from the `/browser/live/socket` WebSocket endpoint. Attaches to the page target, enables focus
 * emulation so a background tab keeps producing frames, starts a JPEG screencast and forwards each frame
 * as one binary message (4-byte big-endian JSON header length, JSON metadata, JPEG bytes). A frame is
 * acknowledged to Chrome only once it was handed to the socket; while the socket is congested only the
 * newest frame is kept. Frame size and quality follow the viewer (`view` message: mode auto/high/low and
 * canvas box); in `auto` the level drops when frames pile up and climbs back after a calm stretch. In
 * `auto` below its top level and in `low` the tab renders at device scale factor 1 (same layout, fewer
 * pixels); the override belongs to this CDP session and is cleared when the viewer leaves. With `fitWindow`
 * (default for a non-macOS Chrome, e.g. a VM on Xvfb) the Chrome window is resized to the viewer's canvas, so
 * the page lays out at that size and frames arrive 1:1, rendered at the viewer's devicePixelRatio at the top level.
 * Viewer messages: mouse, key, insert, navigate, back, forward, reload, switch, new (open a blank tab and show it), view. Every few seconds the
 * viewer gets a `health` message (Chrome answer time, frames, the shown target, last error) for its status and
 * info panel. Navigation buttons re-attach to the shown tab first when its session was lost.
 * No script is evaluated in the page.
 * @param opts.viewer Viewer socket: send, getBufferedAmount and close.
 * @param opts.browserUrl Chrome DevTools HTTP endpoint, such as `http://127.0.0.1:9222`.
 * @param opts.targetId Page target to show first; the most recently used page when omitted or no longer open (Chrome restarted).
 * @param opts.quality JPEG quality of screencast frames. @default 70 @minimum 10 @maximum 100
 * @param opts.focusEmulation Emulate focus so background tabs keep painting. @default true
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Viewer socket: send, getBufferedAmount and close. */
        viewer: Viewer;
        /** Chrome DevTools HTTP endpoint, such as `http://127.0.0.1:9222`. */
        browserUrl: string;
        /** Page target to show first; the most recently used page when omitted or no longer open (Chrome restarted). */
        targetId?: string;
        /** JPEG quality of screencast frames. @default 70 @minimum 10 @maximum 100 */
        quality?: number;
        /** Emulate focus so background tabs keep painting. @default true */
        focusEmulation?: boolean;
        /** Resize the Chrome window to the viewer's canvas so the page lays out at that size and frames come 1:1. @default true for a Chrome not on macOS (a VM/Xvfb Chrome nobody looks at directly), false on macOS */
        fitWindow?: boolean;
    },
): Promise<types.browser.LiveConn> {
    const viewer = opts.viewer;
    const browserUrl = opts.browserUrl.replace(/\/$/, "");
    const quality = Math.max(10, Math.min(100, Math.trunc(opts.quality ?? 70)));
    const focusEmulation = opts.focusEmulation !== false;
    // A slow Chrome (App Nap, heavy tabs) answers DevTools in seconds; wait up to 15 s
    // and then say plainly that Chrome is the problem, not the connection to Hyper.
    const notResponding = (what: string) => new Error(`Chrome is not responding (${what} at ${browserUrl}) — restart it with chrome.start`);
    const version: any = await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(15000) })
        .then((r) => r.json())
        .catch((e: any) => { throw e?.name === "TimeoutError" ? notResponding("no answer in 15 s") : notResponding(e?.message ?? String(e)); });
    // Chrome reports its socket under the address it listens on; reach it under the one we were given.
    const wsUrl = new URL(String(version.webSocketDebuggerUrl));
    const base = new URL(browserUrl);
    wsUrl.host = base.host;
    if (base.protocol === "https:") wsUrl.protocol = "wss:";
    const remoteMac = /Macintosh/.test(String(version["User-Agent"] ?? ""));
    const chromeVersion = String(version.Browser ?? "");
    const fit = opts.fitWindow ?? !remoteMac;

    const cdp = new WebSocket(wsUrl.toString());
    await new Promise<void>((ok, fail) => {
        const timer = setTimeout(() => fail(notResponding("DevTools socket did not open in 15 s")), 15000);
        cdp.onopen = () => { clearTimeout(timer); ok(); };
        cdp.onerror = () => { clearTimeout(timer); fail(notResponding("DevTools socket failed")); };
    });

    let nextId = 0;
    const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
    const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => new Promise((ok, fail) => {
        const id = ++nextId;
        pending.set(id, { ok, fail });
        cdp.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    const callWithin = (ms: number, method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => new Promise((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`Chrome did not answer ${method} in ${ms / 1000} s`)), ms);
        call(method, params, sessionId).then((v) => { clearTimeout(timer); ok(v); }, (e) => { clearTimeout(timer); fail(e); });
    });
    // Input is fired in order without waiting for each answer: a human's pointer
    // trajectory must not be paced by round trips. Failures are only logged.
    const fire = (method: string, params: Record<string, unknown>) => {
        if (!sessionId) return;
        stats.inputs++;
        // The person acting in this viewer gets the window at their size.
        if (fit && (method === "Input.dispatchKeyEvent" || params.type === "mousePressed" || params.type === "mouseWheel")) {
            const f = fits.get(fitKey());
            if (!f || Math.abs(f.w - view.width) >= FIT_STEP || Math.abs(f.h - view.height) >= FIT_STEP) fitWindow();
        }
        call(method, params, sessionId).catch((e) => ctx.fns.procs.log.debug({ event: "browser.live.input", msg: `${method}: ${e.message}` }));
    };

    const targets = new Map<string, Target>();
    let targetId = "";
    let sessionId = "";
    let closed = false;
    let held: { bytes: Uint8Array; ack: number; session: string } | null = null;
    const stats = { frames: 0, dropped: 0, inputs: 0, since: Date.now(), lastFrameAt: 0 };
    const health = { chromeMs: -1, ok: true, checkedAt: 0, error: "" };
    let healthTimer: ReturnType<typeof setInterval> | undefined;

    // Picture profile: what the viewer asked for and the adaptive level in auto.
    const view = { mode: "auto" as "auto" | "high" | "low", width: 0, height: 0, dpr: 1, level: 1 };
    let profile = ctx.fns.browser.liveProfile({ mode: view.mode, level: view.level, baseQuality: quality });
    let restartTimer: ReturnType<typeof setTimeout> | null = null;
    // Device scale 1 while watching in auto/low: same CSS layout, a quarter of
    // the pixels to paint and encode on a Retina screen. width/height 0 keep the
    // window's own size, so the page does not re-layout.
    // A fitted (VM) Chrome has a device scale of 1 on its virtual screen: at the top level it renders at
    // the viewer's devicePixelRatio instead, so text is sharp on a Retina screen. 0 = Chrome's own scale.
    let appliedScale = 0;
    const scaleFor = (p: { lowDensity: boolean }) => p.lowDensity ? 1 : fit ? Math.round(view.dpr * 4) / 4 : 0;
    const setDensity = async (s: string, scale: number) => {
        if (scale === appliedScale) return;
        appliedScale = scale;
        if (scale) await call("Emulation.setDeviceMetricsOverride", { width: 0, height: 0, deviceScaleFactor: scale, mobile: false }, s);
        else await call("Emulation.clearDeviceMetricsOverride", {}, s);
    };
    // Fit the window to the viewer: the page then lays out at the canvas size (like a browser window of
    // that size) and the screencast needs no scaling. Coalesced, and only for changes over FIT_STEP px.
    let fitTimer: ReturnType<typeof setTimeout> | null = null;
    // Shared by every viewer of this Chrome: with two viewers of different sizes the window follows the one
    // that last resized or used it (clicked, typed), not whichever socket happened to speak last.
    const shared: any = (ctx as any).state ? ((ctx.state as any).browser ??= {}) : {};
    const fits: Map<string, { w: number; h: number }> = (shared.liveFit ??= new Map());
    const fitKey = () => `${browserUrl} ${targetId}`;
    const fitWindow = () => {
        if (!fit || !view.width || !view.height) return;
        if (fitTimer) clearTimeout(fitTimer);
        fitTimer = setTimeout(async () => {
            fitTimer = null;
            const s = sessionId, t = targetId;
            const w = Math.round(view.width), h = Math.round(view.height);
            const fitted = fits.get(fitKey());
            if (!s || closed || (fitted && Math.abs(w - fitted.w) < FIT_STEP && Math.abs(h - fitted.h) < FIT_STEP)) return;
            try {
                const { windowId, bounds } = await call("Browser.getWindowForTarget", { targetId: t });
                if (bounds.windowState !== "normal") await call("Browser.setWindowBounds", { windowId, bounds: { windowState: "normal" } });
                // Browser.setContentsSize sizes the page area exactly (Chrome 131+); older Chrome: add the
                // window frame and toolbars (outer size minus the page's CSS viewport) by hand.
                const done = await call("Browser.setContentsSize", { windowId, width: w, height: h }).then(() => true, () => false);
                if (!done) {
                    const m = await call("Page.getLayoutMetrics", {}, s);
                    const cur = (await call("Browser.getWindowBounds", { windowId })).bounds;
                    const vp = m.cssLayoutViewport ?? m.layoutViewport;
                    await call("Browser.setWindowBounds", { windowId, bounds: { width: w + Math.max(0, cur.width - vp.clientWidth), height: h + Math.max(0, cur.height - vp.clientHeight) } });
                }
                fits.set(`${browserUrl} ${t}`, { w, h });
                ctx.fns.procs.log.debug({ event: "browser.live.fit", msg: `page area ${w}x${h}${done ? "" : " (window bounds)"}` });
            } catch (e: any) {
                ctx.fns.procs.log.debug({ event: "browser.live.fit", msg: e.message });
            }
        }, FIT_DELAY_MS);
    };
    const screencastParams = () => ({ format: "jpeg", everyNthFrame: 1, quality: profile.quality, ...(profile.maxWidth ? { maxWidth: profile.maxWidth, maxHeight: profile.maxHeight } : {}) });
    const applyProfile = () => {
        const next = ctx.fns.browser.liveProfile({ ...view, baseQuality: quality });
        const changed = next.quality !== profile.quality || next.maxWidth !== profile.maxWidth || next.maxHeight !== profile.maxHeight || next.lowDensity !== profile.lowDensity || scaleFor(next) !== appliedScale;
        profile = next;
        sendJson({ t: "profile", mode: view.mode, ...profile });
        if (!changed || !sessionId) return;
        // Coalesce bursts (window resizing) into one screencast restart.
        if (restartTimer) clearTimeout(restartTimer);
        restartTimer = setTimeout(() => {
            restartTimer = null;
            const s = sessionId;
            if (!s || closed) return;
            held = null;
            void call("Page.stopScreencast", {}, s)
                .then(() => s === sessionId && !closed ? setDensity(s, scaleFor(profile)) : undefined)
                .then(() => s === sessionId && !closed ? call("Page.startScreencast", screencastParams(), s) : undefined)
                .catch((e) => ctx.fns.procs.log.debug({ event: "browser.live.profile", msg: e.message }));
        }, 150);
    };
    let lastDropped = 0, calm = 0;
    const adaptTimer = setInterval(() => {
        if (closed || view.mode !== "auto") return;
        const dropped = stats.dropped - lastDropped;
        lastDropped = stats.dropped;
        if (dropped > 0 && view.level < 3) { view.level++; calm = 0; applyProfile(); }
        else if (dropped === 0 && view.level > 0 && ++calm >= CALM_WINDOWS) { view.level--; calm = 0; applyProfile(); }
        else if (dropped > 0) calm = 0;
    }, WINDOW_MS);

    const sendJson = (value: unknown) => { if (!closed) viewer.send(JSON.stringify(value)); };
    const pages = () => [...targets.values()].filter((t) => t.type === "page" && !t.url.startsWith("devtools://"));
    let tabsTimer: ReturnType<typeof setTimeout> | null = null;
    const pushTabs = () => {
        if (tabsTimer) return;
        tabsTimer = setTimeout(() => {
            tabsTimer = null;
            sendJson({ t: "tabs", current: targetId, tabs: pages().map((p) => ({ id: p.targetId, title: p.title, url: p.url })) });
        }, 50);
    };
    const packFrame = (meta: Record<string, unknown>, jpeg: Uint8Array) => {
        const header = new TextEncoder().encode(JSON.stringify(meta));
        const out = new Uint8Array(4 + header.length + jpeg.length);
        new DataView(out.buffer).setUint32(0, header.length);
        out.set(header, 4);
        out.set(jpeg, 4 + header.length);
        return out;
    };
    const deliver = (bytes: Uint8Array, ack: number, session: string) => {
        viewer.send(bytes);
        stats.frames++;
        stats.lastFrameAt = Date.now();
        call("Page.screencastFrameAck", { sessionId: ack }, session).catch(() => {});
    };

    cdp.onmessage = (event) => {
        const msg = JSON.parse(String(event.data));
        if (msg.id) {
            const waiter = pending.get(msg.id);
            pending.delete(msg.id);
            if (!waiter) return;
            if (msg.error) waiter.fail(new Error(`${msg.error.message}`));
            else waiter.ok(msg.result);
            return;
        }
        const p = msg.params ?? {};
        switch (msg.method) {
            case "Page.screencastFrame": {
                if (msg.sessionId !== sessionId || closed) return;
                const bytes = packFrame({ ...p.metadata, targetId }, new Uint8Array(Buffer.from(String(p.data), "base64")));
                // Congested socket: keep only the newest frame, ack it when sent.
                if (viewer.getBufferedAmount() > MAX_BUFFERED) {
                    if (held) { stats.dropped++; call("Page.screencastFrameAck", { sessionId: held.ack }, held.session).catch(() => {}); }
                    held = { bytes, ack: p.sessionId, session: msg.sessionId };
                    return;
                }
                deliver(bytes, p.sessionId, msg.sessionId);
                return;
            }
            case "Page.frameNavigated":
                if (msg.sessionId === sessionId && !p.frame?.parentId) sendJson({ t: "nav", url: p.frame?.url });
                return;
            case "Target.targetCreated":
            case "Target.targetInfoChanged":
                targets.set(p.targetInfo.targetId, p.targetInfo);
                if (p.targetInfo.targetId === targetId) sendJson({ t: "target", id: targetId, url: p.targetInfo.url, title: p.targetInfo.title });
                pushTabs();
                return;
            case "Target.targetDestroyed":
                targets.delete(p.targetId);
                pushTabs();
                if (p.targetId === targetId) {
                    sessionId = "";
                    const next = pages()[0];
                    if (next) void show(next.targetId).catch((e) => sendJson({ t: "error", message: e.message }));
                    else sendJson({ t: "error", message: "The tab was closed" });
                }
                return;
            case "Target.detachedFromTarget":
                if (p.sessionId === sessionId) {
                    sessionId = "";
                    // Chrome let go of the tab (crash, swap): pick it up again so frames resume.
                    setTimeout(() => { if (!closed && !sessionId) ensureSession().catch((e) => sendJson({ t: "error", message: e.message })); }, 300);
                }
                return;
        }
    };
    cdp.onclose = () => {
        clearInterval(adaptTimer);
        if (fitTimer) clearTimeout(fitTimer);
        clearInterval(healthTimer);
        for (const w of pending.values()) w.fail(new Error("CDP socket closed"));
        pending.clear();
        if (!closed) { closed = true; try { viewer.close(1011, "Chrome connection lost"); } catch { /* gone */ } }
    };

    const leave = async () => {
        const old = sessionId;
        if (!old) return;
        sessionId = "";
        held = null;
        await call("Page.stopScreencast", {}, old).catch(() => {});
        await setDensity(old, 0).catch(() => {});
        if (focusEmulation) await call("Emulation.setFocusEmulationEnabled", { enabled: false }, old).catch(() => {});
        await call("Target.detachFromTarget", { sessionId: old }).catch(() => {});
    };
    const show = async (id: string) => {
        await leave();
        const attached = await call("Target.attachToTarget", { targetId: id, flatten: true });
        targetId = id;
        sessionId = attached.sessionId;
        await call("Page.enable", {}, sessionId);
        if (focusEmulation) await call("Emulation.setFocusEmulationEnabled", { enabled: true }, sessionId).catch(() => {});
        appliedScale = 0;
        await setDensity(sessionId, scaleFor(profile)).catch((e) => ctx.fns.procs.log.debug({ event: "browser.live.density", msg: e.message }));
        await call("Page.startScreencast", screencastParams(), sessionId);
        fitWindow();
        const info = targets.get(id);
        sendJson({ t: "target", id, url: info?.url ?? "", title: info?.title ?? "" });
        pushTabs();
    };

    const checkHealth = async () => {
        if (closed) return;
        const t0 = Date.now();
        try {
            await callWithin(HEALTH_TIMEOUT_MS, "Browser.getVersion");
            health.chromeMs = Date.now() - t0; health.ok = true; health.error = "";
        } catch (e: any) {
            health.chromeMs = -1; health.ok = false; health.error = e.message;
        }
        health.checkedAt = Date.now();
        const info = targets.get(targetId);
        sendJson({
            t: "health", ok: health.ok, chromeMs: health.chromeMs, error: health.error,
            browserUrl, chrome: chromeVersion, target: targetId, url: info?.url ?? "", attached: !!sessionId,
            frames: stats.frames, dropped: stats.dropped, inputs: stats.inputs,
            lastFrameAgoMs: stats.lastFrameAt ? Date.now() - stats.lastFrameAt : -1, connectedMs: Date.now() - stats.since,
            mode: view.mode, level: profile.level, quality: profile.quality, maxWidth: profile.maxWidth ?? 0, maxHeight: profile.maxHeight ?? 0,
        });
    };
    healthTimer = setInterval(() => { void checkHealth(); }, HEALTH_MS);

    const listed = await call("Target.getTargets");
    for (const t of listed.targetInfos ?? []) targets.set(t.targetId, t);
    await call("Target.setDiscoverTargets", { discover: true });
    // A target id lives only as long as its Chrome: after a restart (crash, hyperd) the viewer
    // reconnects with the old id from its URL. Show the most recent tab instead of failing forever.
    const asked = opts.targetId && targets.has(opts.targetId) ? opts.targetId : "";
    const first = asked || pages()[0]?.targetId;
    if (!first) throw new Error(`No page target in Chrome at ${browserUrl}`);
    if (opts.targetId && !asked) ctx.fns.procs.log.info({ event: "browser.live.target", msg: `target ${opts.targetId} is gone (Chrome restarted?); showing ${first}` });
    await show(first);
    void checkHealth();

    // A tab's session can be lost (renderer crash, Chrome detaching it, an error page
    // swap). Without a session a command would go to the browser target and fail with
    // "'Page.reload' wasn't found"; re-attach to the shown tab, or the first one left.
    const ensureSession = async () => {
        if (sessionId) return sessionId;
        const id = targets.has(targetId) ? targetId : pages()[0]?.targetId;
        if (!id) throw new Error("No open tab in Chrome to show");
        await show(id);
        return sessionId;
    };
    const history = async (step: number) => {
        await ensureSession();
        const h = await call("Page.getNavigationHistory", {}, sessionId);
        const entry = h.entries?.[h.currentIndex + step];
        if (entry) await call("Page.navigateToHistoryEntry", { entryId: entry.id }, sessionId);
    };

    return {
        targetId: () => targetId,
        stats: () => ({ frames: stats.frames, dropped: stats.dropped, inputs: stats.inputs, since: stats.since, lastFrameAt: stats.lastFrameAt, chromeMs: health.chromeMs, chromeOk: health.ok, mode: view.mode, level: profile.level, quality: profile.quality, maxWidth: profile.maxWidth ?? 0, maxHeight: profile.maxHeight ?? 0 }),
        drain: () => {
            if (!held || viewer.getBufferedAmount() > MAX_BUFFERED) return;
            const h = held;
            held = null;
            if (h.session === sessionId) deliver(h.bytes, h.ack, h.session);
        },
        handle: async (message: string) => {
            if (closed) return;
            let m: any;
            try { m = JSON.parse(message); } catch { return; }
            switch (m.t) {
                case "mouse": {
                    const params = ctx.fns.browser.liveMouse(m);
                    if (params) fire("Input.dispatchMouseEvent", params);
                    return;
                }
                case "key": {
                    const params = ctx.fns.browser.liveKey({ ...m, remoteMac });
                    if (params) fire("Input.dispatchKeyEvent", params);
                    return;
                }
                case "insert":
                    if (typeof m.text === "string" && m.text) fire("Input.insertText", { text: m.text });
                    return;
            }
            try {
                switch (m.t) {
                    case "navigate": {
                        const raw = String(m.url ?? "").trim();
                        if (!raw) return;
                        const url = /^[a-z][a-z0-9+.-]*:/i.test(raw) ? raw : /^[^\s/]+\.[^\s/]+/.test(raw) ? `https://${raw}` : `https://www.google.com/search?q=${encodeURIComponent(raw)}`;
                        await call("Page.navigate", { url }, await ensureSession());
                        return;
                    }
                    case "back": return await history(-1);
                    case "forward": return await history(1);
                    case "reload": await call("Page.reload", {}, await ensureSession()); return;
                    case "new": {
                        // A new blank tab, shown at once; the viewer then types its address.
                        const created = await call("Target.createTarget", { url: "about:blank" });
                        await show(String(created.targetId));
                        return;
                    }
                    case "switch":
                        if (typeof m.id === "string" && targets.has(m.id)) await show(m.id);
                        return;
                    case "close":
                        // Closes one Chrome tab; Target.targetDestroyed then updates the list and, for the shown one,
                        // moves the view to the next tab.
                        if (typeof m.id === "string" && targets.has(m.id)) await call("Target.closeTarget", { targetId: m.id });
                        return;
                    case "view": {
                        if (m.mode === "auto" || m.mode === "high" || m.mode === "low") {
                            if (m.mode === "auto" && view.mode !== "auto") { view.level = 1; calm = 0; }
                            view.mode = m.mode;
                        }
                        const num = (v: unknown, lo: number, hi: number) => Number.isFinite(Number(v)) ? Math.max(lo, Math.min(hi, Number(v))) : undefined;
                        view.width = num(m.width, 0, 8192) ?? view.width;
                        view.height = num(m.height, 0, 8192) ?? view.height;
                        view.dpr = num(m.dpr, 1, 3) ?? view.dpr;
                        applyProfile();
                        fitWindow();
                        return;
                    }
                }
            } catch (e: any) {
                sendJson({ t: "error", message: e.message });
            }
        },
        close: async () => {
            if (closed) return;
            await leave().catch(() => {});
            closed = true;
            if (tabsTimer) clearTimeout(tabsTimer);
            if (restartTimer) clearTimeout(restartTimer);
            clearInterval(adaptTimer);
            if (fitTimer) clearTimeout(fitTimer);
            clearInterval(healthTimer);
            try { cdp.close(); } catch { /* gone */ }
        },
    };
}
