// Return a live named CDP page websocket, attaching to a requested target or
// creating a background tab. Runtime handles are deliberately in ctx.state,
// never module globals, so hot reload does not fork the connection registry.
/**
 * Creates or reconnects a named Chrome page session, preserving its original target.
 * A disconnected or missing previously selected target never creates a replacement tab.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
  /** Logical session name used for reuse. */
  name?: string;
  /** Existing browser target identifier to attach to. */
  targetId?: string } = {},
): Promise<any> {
    const scope = await ctx.fns.cdp.scope({ session: opts.name, targetId: opts.targetId });
    opts = { ...opts, name: scope.session, targetId: scope.targetId };
    const name = String(opts.name || "main");
    const state = ((ctx.state as any).cdp ??= { sessions: new Map() });
    const sessions: Map<string, any> = (state.sessions ??= new Map());
    const existing = sessions.get(name);
    if (existing?.closed) throw new Error(`CDP target ${existing.targetId} was closed`);
    if (existing?.targetId && opts.targetId && existing.targetId !== opts.targetId) {
        throw new Error(`CDP session ${name} is already bound to target ${existing.targetId}`);
    }
    if (existing?.ws?.readyState === WebSocket.OPEN) {
        existing.lastUsed = Date.now();
        return existing;
    }

    const browserUrl = String(ctx.env.CDP_BROWSER_URL || "http://127.0.0.1:9222").replace(/\/$/, "");
    const probe = () => fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(3000) }).catch(() => null);
    // Chrome not running (reboot, crash, user quit it): start the profile once
    // instead of failing every browser call until someone starts it by hand.
    // Tabs of a dead browser are gone, so remembered bindings are dropped.
    // CDP_AUTOSTART=0 opts out. Only consulted after a failure: a live
    // reconnect costs nothing extra.
    // One recovery at a time per server: concurrent callers share it, and the
    // stale bindings are dropped exactly once, before anyone opens a new tab —
    // a second caller finishing late can no longer close a freshly opened one.
    const restartChrome = async (): Promise<boolean> => {
        if (ctx.env.CDP_AUTOSTART === "0" || !(ctx.fns as any).chrome?.ensure) return false;
        if (state.recovering) return await state.recovering;
        if ((await probe())?.ok) return false;
        if (state.recovering) return await state.recovering;
        state.recovering = (async () => {
            for (const [key, handle] of sessions) { try { handle.ws?.close(); } catch {} sessions.delete(key); }
            await (ctx.fns as any).chrome.ensure({});
            return !!(await probe())?.ok;
        })().finally(() => { state.recovering = undefined; });
        return await state.recovering;
    };
    let targetId = existing?.targetId || opts.targetId;
    if (!targetId) {
        let version = await probe();
        if (!version?.ok && await restartChrome()) version = await probe();
        if (!version?.ok) throw new Error(`Chrome CDP unavailable at ${browserUrl} (${version?.status ?? "no answer"})`);
        const info: any = await version.json();
        targetId = await new Promise<string>((resolve, reject) => {
            const ws = new WebSocket(info.webSocketDebuggerUrl);
            const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP Target.createTarget timed out")); }, 5000);
            ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Target.createTarget", params: { url: "about:blank", background: true } }));
            ws.onmessage = (event) => {
                const message = JSON.parse(String(event.data));
                if (message.id !== 1) return;
                clearTimeout(timer);
                ws.close();
                if (message.error) reject(new Error(message.error.message));
                else resolve(message.result.targetId);
            };
            ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP browser websocket failed")); };
        });
    }

    // Retain target identity even if the first connection attempt fails.
    if (!existing) sessions.set(name, { name, targetId, ws: null, pending: new Map() });
    const wsUrl = `${browserUrl.replace(/^http/, "ws")}/devtools/page/${targetId}`;
    try {
        return await connect(wsUrl, targetId);
    } catch (error) {
        // The remembered tab belonged to a browser that is gone: start Chrome
        // and open a fresh tab once. A live browser with a dead tab keeps the
        // original error (the caller decides what a lost tab means).
        if (opts.targetId || !(await restartChrome())) throw error;
        return await ctx.fns.cdp.session({ name });
    }

    function connect(wsUrl: string, targetId: string): Promise<any> {
    return new Promise<any>((resolve, reject) => {
        const ws = new WebSocket(wsUrl);
        const handle: any = { name, targetId, ws, msgId: 0, pending: new Map(), lastUsed: Date.now() };
        const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP page websocket timed out")); }, 5000);
        ws.onopen = () => {
            clearTimeout(timer);
            sessions.set(name, handle);
            resolve(handle);
        };
        ws.onmessage = (event) => {
            const message = JSON.parse(String(event.data));
            const pending = message.id ? handle.pending.get(message.id) : null;
            if (!pending) return;
            handle.pending.delete(message.id);
            message.error ? pending.reject(new Error(message.error.message)) : pending.resolve(message.result);
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error(`CDP tab ${targetId} websocket failed`)); };
        ws.onclose = () => {
            clearTimeout(timer);
            const error = new Error(`CDP tab ${targetId} disconnected; command outcome may be unknown`);
            for (const pending of handle.pending.values()) pending.reject(error);
            handle.pending.clear();
            reject(error);
            // Keep the handle as a target-identity tombstone for reconnect.
        };
    });
    }
}
