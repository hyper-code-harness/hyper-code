/**
 * Reloads the active unpacked Hyper Chrome extension through CDP
 *
 * Use after editing browser-extension files to reload the running unpacked Hyper extension without opening chrome://extensions. It locates the Hyper service worker target and invokes chrome.runtime.reload().
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ extensionId: string; reloaded: true }> {
    const browserUrl = String(ctx.env.CDP_BROWSER_URL || "http://127.0.0.1:9222").replace(/\/$/, "");
    const response = await fetch(`${browserUrl}/json/list`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Chrome CDP returned HTTP ${response.status}`);
    const targets = await response.json() as any[];
    const worker = targets.find(target => target.type === "service_worker" && String(target.url).startsWith("chrome-extension://") && String(target.url).endsWith("/worker.js"));
    if (!worker?.webSocketDebuggerUrl) throw new Error("Hyper extension worker is not active; open its sidebar once and retry");
    const extensionId = new URL(worker.url).hostname;
    await new Promise<void>((resolve, reject) => {
      const ws = new WebSocket(worker.webSocketDebuggerUrl);
      const timer = setTimeout(() => { try { ws.close(); } catch {} reject(new Error("Extension reload timed out")); }, 5000);
      ws.onopen = () => ws.send(JSON.stringify({ id: 1, method: "Runtime.evaluate", params: { expression: "chrome.runtime.reload()", awaitPromise: false } }));
      ws.onmessage = event => {
        const message = JSON.parse(String(event.data));
        if (message.id !== 1) return;
        clearTimeout(timer);
        try { ws.close(); } catch {}
        message.error ? reject(new Error(message.error.message)) : resolve();
      };
      ws.onerror = () => { clearTimeout(timer); reject(new Error("Extension CDP connection failed")); };
    });
    return { extensionId, reloaded: true };
}
