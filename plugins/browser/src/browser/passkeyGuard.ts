// Keeps macOS passkey dialogs out of the shared Chrome. A page asking for a passkey
// (navigator.credentials) makes Chrome on macOS 13.5+ talk to iCloud Keychain through a
// system window (ViewBridge). This Chrome runs under a user without a graphical session:
// nobody can see or close that window, and Chrome's main thread waits for it — CDP, the
// live view and every browser.* call hang for seconds at a time. A WebAuthn virtual
// authenticator on every tab answers such requests inside Chrome, so the system window
// is never asked for. Real iCloud/phone passkeys are not reachable on these tabs.

type Guard = {
    browserUrl: string;
    ws: WebSocket | null;
    timer: ReturnType<typeof setInterval> | null;
    connecting: boolean;
    tabs: Set<string>;
    errors: number;
    lastError: string;
    startedAt: number;
};

/**
 * Puts a WebAuthn virtual authenticator on every tab of the shared Chrome so that pages asking for a
 * passkey never open the macOS system passkey / iCloud Keychain window.
 *
 * Use at startup (the browser plugin calls it from `$start`) or after changing Chrome; calling it again
 * only reports. Holds one browser-level CDP socket in ctx.state, auto-attaches to every page (existing and
 * new) and calls `WebAuthn.enable` + `WebAuthn.addVirtualAuthenticator` (CTAP2, internal transport,
 * resident keys, user verification, presence simulated). Reconnects every 5 s when Chrome restarts.
 * Turn off with the setting `browser.virtualPasskeys` (env BROWSER_VIRTUAL_PASSKEYS=0) and `stop: true`.
 * @param opts.browserUrl Chrome DevTools HTTP endpoint. @default CDP_BROWSER_URL
 * @param opts.stop Close the guard socket and stop reconnecting. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Chrome DevTools HTTP endpoint. @default CDP_BROWSER_URL */
        browserUrl?: string;
        /** Close the guard socket and stop reconnecting. @default false */
        stop?: boolean;
    } = {},
): Promise<{ running: boolean; connected: boolean; browserUrl: string; tabs: number; errors: number; lastError: string }> {
    const st = ((ctx.state as any).browser ??= {});
    const browserUrl = (opts.browserUrl ?? ctx.fns.procs.env.cdpUrl({})).replace(/\/$/, "");
    const report = (g: Guard | undefined) => ({
        running: !!g?.timer, connected: g?.ws?.readyState === WebSocket.OPEN, browserUrl: g?.browserUrl ?? browserUrl,
        tabs: g?.tabs.size ?? 0, errors: g?.errors ?? 0, lastError: g?.lastError ?? "",
    });

    const old: Guard | undefined = st.passkeyGuard;
    if (opts.stop || (old && old.browserUrl !== browserUrl)) {
        if (old?.timer) clearInterval(old.timer);
        try { old?.ws?.close(); } catch { /* gone */ }
        if (old) old.timer = null;
        st.passkeyGuard = undefined;
        if (opts.stop) return report(old);
    }
    if (st.passkeyGuard) return report(st.passkeyGuard);

    const g: Guard = { browserUrl, ws: null, timer: null, connecting: false, tabs: new Set(), errors: 0, lastError: "", startedAt: Date.now() };
    st.passkeyGuard = g;
    const fail = (e: any) => { g.errors++; g.lastError = String(e?.message ?? e); };

    const connect = async () => {
        if (g.connecting || st.passkeyGuard !== g) return;
        if (g.ws && g.ws.readyState <= WebSocket.OPEN) return;
        g.connecting = true;
        try {
            const version: any = await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(5000) }).then((r) => r.json());
            const wsUrl = new URL(String(version.webSocketDebuggerUrl));
            wsUrl.host = new URL(browserUrl).host;
            const ws = new WebSocket(wsUrl.toString());
            g.ws = ws;
            g.tabs.clear();
            let nextId = 0;
            const send = (method: string, params: Record<string, unknown> = {}, sessionId?: string) =>
                ws.send(JSON.stringify({ id: ++nextId, method, params, ...(sessionId ? { sessionId } : {}) }));
            ws.onopen = () => {
                // Every page, now and later; flat sessions; never pause a new tab.
                send("Target.setAutoAttach", { autoAttach: true, waitForDebuggerOnStart: false, flatten: true, filter: [{ type: "page" }] });
            };
            ws.onmessage = (event) => {
                const msg = JSON.parse(String(event.data));
                if (msg.error) { fail(new Error(msg.error.message)); return; }
                if (msg.method === "Target.attachedToTarget" && msg.params?.targetInfo?.type === "page") {
                    const sid = String(msg.params.sessionId);
                    g.tabs.add(sid);
                    // enableUI false: no Chrome dialog either; presence and UV are answered by the authenticator.
                    send("WebAuthn.enable", { enableUI: false }, sid);
                    send("WebAuthn.addVirtualAuthenticator", { options: {
                        protocol: "ctap2", transport: "internal", hasResidentKey: true, hasUserVerification: true,
                        isUserVerified: true, automaticPresenceSimulation: true,
                    } }, sid);
                } else if (msg.method === "Target.detachedFromTarget") {
                    g.tabs.delete(String(msg.params?.sessionId));
                }
            };
            ws.onclose = () => { if (g.ws === ws) { g.ws = null; g.tabs.clear(); } };
            ws.onerror = () => fail(new Error("guard socket error"));
        } catch (e) {
            fail(e);
        } finally {
            g.connecting = false;
        }
    };

    g.timer = setInterval(() => { void connect(); }, 5000);
    await connect();
    await Bun.sleep(300);
    ctx.fns.procs.log.info({ event: "browser.passkeyGuard", msg: `virtual authenticator on ${g.tabs.size} tab(s) of ${browserUrl}` });
    return report(g);
}
