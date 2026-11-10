// Supervise Chrome without sending the stop signal to its renderers first.
// Usage: bun hyperd/chrome.ts -- <chrome executable> <args...>
// Unit: stop: { target: process, timeoutMs: 20000 }, pty: false.
// CDP_BROWSER_URL must identify this child's loopback debugging endpoint.
// hyperd's timeout is the final process-group SIGKILL safety net.
const args = process.argv.slice(2);
// Bun versions differ on retaining the argv separator.
if (args[0] === "--") args.shift();
if (!args.length) throw new Error("usage: chrome.ts -- <chrome> <args...>");
const endpoint = new URL(process.env.CDP_BROWSER_URL ?? "http://127.0.0.1:9222");
if (!['127.0.0.1', '[::1]', 'localhost'].includes(endpoint.hostname)) throw new Error("Chrome supervisor requires a loopback CDP endpoint");
const timeoutMs = Number(process.env.CHROME_CLOSE_TIMEOUT_MS ?? 8000);
if (!Number.isFinite(timeoutMs) || timeoutMs < 100 || timeoutMs > 60000) throw new Error("CHROME_CLOSE_TIMEOUT_MS must be 100..60000");
const child = Bun.spawn(args, {stdin:"ignore", stdout:"inherit", stderr:"inherit"});
let stopping = false;
async function stop() {
    if (stopping) return;
    stopping = true;
    let socket: WebSocket | undefined;
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
        const close = async () => {
            const response = await fetch(new URL('/json/version', endpoint), {signal:AbortSignal.timeout(timeoutMs)});
            if (!response.ok) throw new Error(`CDP discovery HTTP ${response.status}`);
            const info = await response.json() as {webSocketDebuggerUrl?:string};
            if (!info.webSocketDebuggerUrl) throw new Error("CDP browser websocket missing");
            const address = new URL(info.webSocketDebuggerUrl);
            if (address.host !== endpoint.host || address.protocol !== 'ws:') throw new Error("CDP websocket endpoint mismatch");
            await new Promise<void>((resolve, reject) => {
                socket = new WebSocket(address);
                socket.onopen = () => { socket!.send(JSON.stringify({id:1,method:'Browser.close'})); resolve(); };
                socket.onerror = () => reject(new Error('CDP websocket failed'));
                socket.onclose = () => reject(new Error('CDP websocket closed before request'));
            });
            await child.exited;
        };
        await Promise.race([close(), new Promise<never>((_, reject) => { timer = setTimeout(() => reject(new Error('graceful close timed out')), timeoutMs); })]);
        console.log('chrome supervisor: Browser.close completed');
    } catch (error) {
        console.error(`chrome supervisor: ${error}; falling back to browser SIGTERM`);
        child.kill('SIGTERM');
    } finally {
        clearTimeout(timer);
        socket?.close();
    }
}
process.on('SIGTERM', () => { void stop(); });
process.on('SIGINT', () => { void stop(); });
const code = await child.exited;
// Let the close handler log completion before the leader exits and holder cleans its group.
await Bun.sleep(0);
process.exit(code);
