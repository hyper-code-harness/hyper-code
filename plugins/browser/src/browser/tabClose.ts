// Close a Chrome page by named plugin session or explicit target id.
/**
 * Closes a browser tab by session or target identifier.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
  /** Logical browser session whose tab should be closed. */
  session?: string;
  /** Browser target identifier to close. */
  targetId?: string },
): Promise<{ closed: string }> {
    const scope = await ctx.fns.cdp.scope({ session: opts.session, targetId: opts.targetId });
    opts = { ...opts, session: scope.session, targetId: scope.targetId };
    const sessions: Map<string, any> | undefined = (ctx.state as any).cdp?.sessions;
    const handle = opts.session ? sessions?.get(opts.session) : null;
    const targetId = String(opts.targetId || handle?.targetId || "");
    if (!targetId) throw new Error("browser.tabClose: session or targetId is required");

    const browserUrl = ctx.fns.procs.env.cdpUrl({});
    const version = await fetch(`${browserUrl}/json/version`, { signal: AbortSignal.timeout(3000) });
    if (!version.ok) throw new Error(`Chrome CDP unavailable at ${browserUrl} (${version.status})`);
    const info: any = await version.json();
    await new Promise<void>((resolve, reject) => {
        const ws = new WebSocket(info.webSocketDebuggerUrl);
        const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("CDP Target.closeTarget timed out")); }, 5000);
        ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Target.closeTarget", params: { targetId } }));
        ws.onmessage = (event) => {
            const message = JSON.parse(String(event.data));
            if (message.id !== 1) return;
            clearTimeout(timer);
            ws.close();
            message.error ? reject(new Error(message.error.message)) : resolve();
        };
        ws.onerror = () => { clearTimeout(timer); reject(new Error("CDP browser websocket failed")); };
    });
    // Preserve every logical name pointing at the closed target: later calls must
    // fail on that target, never silently create a replacement page.
    for (const entry of sessions?.values() ?? []) {
        if (entry.targetId !== targetId) continue;
        entry.closed = true;
        try { entry.ws?.close(); } catch {}
    }
    return { closed: targetId };
}
