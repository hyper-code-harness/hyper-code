import path from "node:path";
import os from "node:os";

type Pending = { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> };
type Conn = { proc: ReturnType<typeof Bun.spawn>; pending: Map<number, Pending>; nextId: number; ready: Promise<void>; dead: boolean; idleMs: number; idleTimer?: ReturnType<typeof setTimeout> };

// Connections survive hot reloads: one long-lived `cua-driver mcp` per host keeps snapshot and screenshot
// context (element indexes, pixel clicks) valid across calls.
const pool: Map<string, Conn> = ((globalThis as any).__desktopCuaPool ??= new Map());

function connect(host: string, keepAwake: boolean, idleMs: number): Conn {
    const bin = "~/.local/bin/cua-driver";
    // On remote Macs, `caffeinate -w $$` lives exactly as long as this `cua-driver mcp` (exec keeps the pid),
    // so the display does not sleep or auto-lock while we are connected, and nothing lingers after disconnect.
    const remote = keepAwake ? `caffeinate -dims -w $$ >/dev/null 2>&1 & exec ${bin} mcp` : `exec ${bin} mcp`;
    const cmd = host === "local"
        ? [path.join(os.homedir(), ".local/bin/cua-driver"), "mcp"]
        : ["ssh", "-o", "BatchMode=yes", "-o", "ServerAliveInterval=15", host, remote];
    const proc = Bun.spawn(cmd, { stdin: "pipe", stdout: "pipe", stderr: "pipe" });
    const conn: Conn = { proc, pending: new Map(), nextId: 0, ready: Promise.resolve(), dead: false, idleMs };
    const fail = (why: string) => {
        conn.dead = true;
        if (conn.idleTimer) clearTimeout(conn.idleTimer);
        pool.delete(host);
        for (const p of conn.pending.values()) { clearTimeout(p.timer); p.reject(new Error(why)); }
        conn.pending.clear();
    };
    (async () => {
        let buf = "";
        const dec = new TextDecoder();
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
            buf += dec.decode(chunk, { stream: true });
            let i;
            while ((i = buf.indexOf("\n")) >= 0) {
                const line = buf.slice(0, i); buf = buf.slice(i + 1);
                let m: any; try { m = JSON.parse(line); } catch { continue; }
                const p = typeof m.id === "number" ? conn.pending.get(m.id) : undefined;
                if (!p) continue;
                conn.pending.delete(m.id); clearTimeout(p.timer);
                m.error ? p.reject(new Error(`cua-driver: ${m.error.message ?? JSON.stringify(m.error)}`)) : p.resolve(m.result);
            }
        }
        const err = await new Response(proc.stderr as ReadableStream<Uint8Array>).text().catch(() => "");
        fail(`desktop: cua-driver on ${host} exited${err ? `: ${err.trim().slice(-400)}` : ""}`);
    })();
    const send = (method: string, params: unknown, timeoutMs: number) => new Promise<any>((resolve, reject) => {
        if (conn.dead) return reject(new Error(`desktop: connection to ${host} is closed`));
        const id = ++conn.nextId;
        const timer = setTimeout(() => { conn.pending.delete(id); reject(new Error(`desktop: ${method} timed out after ${timeoutMs} ms on ${host}`)); }, timeoutMs);
        conn.pending.set(id, { resolve, reject, timer });
        (proc.stdin as any).write(JSON.stringify({ jsonrpc: "2.0", id, method, params }) + "\n");
    });
    (conn as any).send = send;
    conn.ready = send("initialize", { protocolVersion: "2025-06-18", capabilities: {}, clientInfo: { name: "hyper-desktop", version: "1" } }, 30000)
        .then(() => { (proc.stdin as any).write(JSON.stringify({ jsonrpc: "2.0", method: "notifications/initialized" }) + "\n"); });
    conn.ready.catch(() => { try { proc.kill(); } catch {} });
    pool.set(host, conn);
    // Snapshot and screenshot ids live inside one MCP connection; forget the old ones.
    const snaps: Map<string, unknown> | undefined = (globalThis as any).__desktopCuaSnaps;
    if (snaps) for (const k of [...snaps.keys()]) if (k.startsWith(`${host}:`)) snaps.delete(k);
    return conn;
}

/**
 * Calls one Cua Driver tool on this Mac or on a remote host over a persistent MCP connection and returns its structured result.
 *
 * Low-level bridge behind every desktop.* function. On remote hosts the connection also runs `caffeinate` so the Mac does not sleep or auto-lock while connected (setting desktop.keepAwake); idle connections close after desktop.idleDisconnectMinutes. Cua Driver (https://github.com/trycua/cua, installed as /Applications/CuaDriver.app with the ~/.local/bin/cua-driver CLI) performs Accessibility and screenshot work inside its own permission-holding app; this function keeps one `cua-driver mcp` process per host (locally, or `ssh <host>` for remote Macs) so snapshots and screenshot context stay valid between calls. Screenshot images in the reply are written to PNG files in the temp directory. Use for tools without a typed wrapper (list them with desktop.tools), e.g. drag, zoom, invoke_menu, clipboard_read.
 * @param opts.tool Cua Driver tool name, e.g. get_window_state, click, type_text, hotkey.
 * @param opts.args Tool arguments exactly as documented by `cua-driver describe <tool>`.
 * @param opts.host SSH host alias of a remote Mac with Cua Driver installed; omit or pass local for this machine. @default local
 * @param opts.timeoutMs Maximum wait for the tool reply in milliseconds. @default 60000 @minimum 1000 @maximum 600000
 * @param opts.allowError Return tool refusals as isError results instead of throwing. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Cua Driver tool name, e.g. get_window_state, click, type_text, hotkey. */
        tool: string;
        /** Tool arguments exactly as documented by `cua-driver describe <tool>`. */
        args?: Record<string, unknown>;
        /** SSH host alias of a remote Mac with Cua Driver installed; omit or pass local for this machine. @default local */
        host?: string;
        /** Maximum wait for the tool reply in milliseconds. @default 60000 @minimum 1000 @maximum 600000 */
        timeoutMs?: number;
        /** Return tool refusals as isError results instead of throwing. @default false */
        allowError?: boolean;
    },
): Promise<{ host: string; tool: string; ms: number; isError: boolean; structured: Record<string, any> | null; text: string; images: string[] }> {
    const host = opts.host || "local";
    let conn = pool.get(host);
    if (!conn || conn.dead) {
        // First contact with this host in this server process: pin the daemon's fast mode before connecting.
        const ensured: Map<string, Promise<unknown>> = ((globalThis as any).__desktopCuaEnsured ??= new Map());
        if (!ensured.has(host)) ensured.set(host, ctx.fns.desktop.ensureDaemon({ host }).catch(e => { ensured.delete(host); console.warn(String(e)); }));
        await ensured.get(host);
        conn = pool.get(host);
        if (!conn || conn.dead) {
            const keepAwake = (await ctx.fns.settings.get({ module: "desktop", key: "keepAwake", scopeType: "global" }) as boolean | undefined) ?? true;
            const idleMin = (await ctx.fns.settings.getNumber({ module: "desktop", key: "idleDisconnectMinutes", scopeType: "global", fallback: 10 })) ?? 10;
            conn = connect(host, keepAwake, Math.max(0, idleMin) * 60_000);
        }
    }
    await conn.ready;
    const c = conn;
    const arm = () => {
        if (c.idleTimer) clearTimeout(c.idleTimer);
        if (c.idleMs > 0) c.idleTimer = setTimeout(() => { if (c.pending.size === 0) { try { c.proc.kill(); } catch {} } else arm(); }, c.idleMs);
    };
    arm();
    const started = performance.now();
    let result: any;
    try { result = await (conn as any).send("tools/call", { name: opts.tool, arguments: opts.args ?? {} }, opts.timeoutMs ?? 60000); }
    finally { arm(); }
    const content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> = result?.content ?? [];
    const images: string[] = [];
    for (const c of content) {
        if (c.type !== "image" || !c.data) continue;
        const ext = c.mimeType?.includes("jpeg") ? "jpg" : "png";
        const file = path.join(os.tmpdir(), `desktop-${host}-${Date.now()}-${images.length}.${ext}`);
        await Bun.write(file, Buffer.from(c.data, "base64"));
        images.push(file);
    }
    const text = content.filter(c => c.type === "text").map(c => c.text ?? "").join("\n");
    const isError = !!result?.isError;
    const sc = result?.structuredContent;
    if (opts.tool === "get_window_state" && !isError && sc?.window_id) {
        // Remember the latest snapshot/screenshot per window so actions can use element indexes and pixel
        // coordinates without the caller threading snapshot ids through.
        const snaps: Map<string, unknown> = ((globalThis as any).__desktopCuaSnaps ??= new Map());
        snaps.set(`${host}:${sc.pid}:${sc.window_id}`, {
            snapshotId: sc.snapshot_id, hasScreenshot: images.length > 0 || !!sc.screenshot_width,
            width: sc.screenshot_width, height: sc.screenshot_height, image: images[0],
            elements: Array.isArray(sc.elements) ? sc.elements : [], at: Date.now(),
        });
    }
    if (isError && !opts.allowError) throw new Error(`desktop.${opts.tool}@${host}: ${text.slice(0, 1000)}`);
    return { host, tool: opts.tool, ms: Math.round(performance.now() - started), isError, structured: result?.structuredContent ?? null, text, images };
}
