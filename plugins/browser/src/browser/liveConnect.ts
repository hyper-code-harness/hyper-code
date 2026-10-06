// The live-view bridge for one viewer: a browser-level CDP socket with a flat
// session on the shown page. Chrome's screencast JPEGs go to the viewer as they
// are (no re-encoding), the viewer's mouse and keys come back as Input.* events.
// Nothing is evaluated in, or injected into, the page: only Target.*, Page.*
// navigation/screencast, Input.* and Emulation.setFocusEmulationEnabled (so a
// background tab keeps painting) are used.

type Viewer = { send: (data: string | Uint8Array) => number; getBufferedAmount: () => number; close: (code?: number, reason?: string) => void };
type Target = { targetId: string; type: string; title: string; url: string; attached?: boolean };

const MAX_BUFFERED = 1 << 20;

/**
 * Opens the CDP side of one live-view viewer and returns a handle that bridges it to the viewer socket.
 *
 * Use from the `/browser/live/socket` WebSocket endpoint. Attaches to the page target, enables focus
 * emulation so a background tab keeps producing frames, starts a JPEG screencast and forwards each frame
 * as one binary message (4-byte big-endian JSON header length, JSON metadata, JPEG bytes). A frame is
 * acknowledged to Chrome only once it was handed to the socket; while the socket is congested only the
 * newest frame is kept. Viewer messages: mouse, key, insert, navigate, back, forward, reload, switch.
 * No script is evaluated in the page.
 * @param opts.viewer Viewer socket: send, getBufferedAmount and close.
 * @param opts.browserUrl Chrome DevTools HTTP endpoint, such as `http://127.0.0.1:9222`.
 * @param opts.targetId Page target to show first; the most recently used page when omitted.
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
        /** Page target to show first; the most recently used page when omitted. */
        targetId?: string;
        /** JPEG quality of screencast frames. @default 70 @minimum 10 @maximum 100 */
        quality?: number;
        /** Emulate focus so background tabs keep painting. @default true */
        focusEmulation?: boolean;
    },
): Promise<types.browser.LiveConn> {
    const viewer = opts.viewer;
    const browserUrl = opts.browserUrl.replace(/\/$/, "");
    const quality = Math.max(10, Math.min(100, Math.trunc(opts.quality ?? 70)));
    const focusEmulation = opts.focusEmulation !== false;
    const version: any = await (await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(5000) })).json();
    // Chrome reports its socket under the address it listens on; reach it under the one we were given.
    const wsUrl = new URL(String(version.webSocketDebuggerUrl));
    const base = new URL(browserUrl);
    wsUrl.host = base.host;
    if (base.protocol === "https:") wsUrl.protocol = "wss:";
    const remoteMac = /Macintosh/.test(String(version["User-Agent"] ?? ""));

    const cdp = new WebSocket(wsUrl.toString());
    await new Promise<void>((ok, fail) => {
        const timer = setTimeout(() => fail(new Error(`CDP ${wsUrl} did not open`)), 5000);
        cdp.onopen = () => { clearTimeout(timer); ok(); };
        cdp.onerror = () => { clearTimeout(timer); fail(new Error(`CDP ${wsUrl} failed`)); };
    });

    let nextId = 0;
    const pending = new Map<number, { ok: (v: any) => void; fail: (e: Error) => void }>();
    const call = (method: string, params: Record<string, unknown> = {}, sessionId?: string): Promise<any> => new Promise((ok, fail) => {
        const id = ++nextId;
        pending.set(id, { ok, fail });
        cdp.send(JSON.stringify({ id, method, params, ...(sessionId ? { sessionId } : {}) }));
    });
    // Input is fired in order without waiting for each answer: a human's pointer
    // trajectory must not be paced by round trips. Failures are only logged.
    const fire = (method: string, params: Record<string, unknown>) => {
        if (!sessionId) return;
        stats.inputs++;
        call(method, params, sessionId).catch((e) => ctx.fns.procs.log.debug({ event: "browser.live.input", msg: `${method}: ${e.message}` }));
    };

    const targets = new Map<string, Target>();
    let targetId = "";
    let sessionId = "";
    let closed = false;
    let held: { bytes: Uint8Array; ack: number; session: string } | null = null;
    const stats = { frames: 0, dropped: 0, inputs: 0, since: Date.now() };

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
                if (p.sessionId === sessionId) sessionId = "";
                return;
        }
    };
    cdp.onclose = () => {
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
        await call("Page.startScreencast", { format: "jpeg", quality, everyNthFrame: 1 }, sessionId);
        const info = targets.get(id);
        sendJson({ t: "target", id, url: info?.url ?? "", title: info?.title ?? "" });
        pushTabs();
    };

    const listed = await call("Target.getTargets");
    for (const t of listed.targetInfos ?? []) targets.set(t.targetId, t);
    await call("Target.setDiscoverTargets", { discover: true });
    const first = opts.targetId || pages()[0]?.targetId;
    if (!first) throw new Error(`No page target in Chrome at ${browserUrl}`);
    if (!targets.has(first)) throw new Error(`Target ${first} is not open in Chrome at ${browserUrl}`);
    await show(first);

    const history = async (step: number) => {
        const h = await call("Page.getNavigationHistory", {}, sessionId);
        const entry = h.entries?.[h.currentIndex + step];
        if (entry) await call("Page.navigateToHistoryEntry", { entryId: entry.id }, sessionId);
    };

    return {
        targetId: () => targetId,
        stats: () => ({ ...stats }),
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
                        await call("Page.navigate", { url }, sessionId);
                        return;
                    }
                    case "back": return await history(-1);
                    case "forward": return await history(1);
                    case "reload": await call("Page.reload", {}, sessionId); return;
                    case "switch":
                        if (typeof m.id === "string" && targets.has(m.id)) await show(m.id);
                        return;
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
            try { cdp.close(); } catch { /* gone */ }
        },
    };
}
