// The tsgo language server as a long-lived child process speaking LSP over stdio.
//
// Why out of process: the in-process TypeScript Language Service checks
// synchronously on the event loop (100–800 ms per eval on this project), which
// stalls every agent stream and HTTP request. tsgo runs in its own process,
// answers a warm check in a few ms, and a crash there cannot take the server
// down.
//
// One client per server; concurrent callers share the in-flight start. A dead
// process is restarted on the next call unless it crashed 3 times within a
// minute, then tsgo stays off (lastError says why) and callers fall back.
import { watch } from "node:fs";
import { join, relative } from "node:path";

/**
 * Returns the running tsgo language-server client, starting it on first use.
 *
 * Spawns `tsgo --lsp --stdio` in the project root, performs the LSP initialize
 * handshake, and watches src/ (and script/) so on-disk changes reach tsgo as
 * workspace/didChangeWatchedFiles before the next check. Returns null when tsgo
 * is not installed or keeps crashing.
 * @param opts.restart Stop a running client first and start a fresh one. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Stop a running client first and start a fresh one. @default false */
        restart?: boolean;
    },
): Promise<types.tsgo.Client | null> {
    const st = ((ctx.state as any).tsgo ??= {}) as types.tsgo.State;
    if (opts.restart && st.client) { await st.client.close(); st.client = undefined; }
    if (st.client?.alive) return st.client;
    if (st.starting) return st.starting;
    const now = Date.now();
    st.crashes = (st.crashes ?? []).filter(t => now - t < 60_000);
    if (st.crashes.length >= 3 && !opts.restart) return null;
    st.starting = start(ctx, st).finally(() => { st.starting = undefined; });
    return st.starting;
}

async function start(ctx: Context, st: types.tsgo.State): Promise<types.tsgo.Client | null> {
    const bin = await ctx.fns.tsgo.bin({});
    if (!bin) { st.lastError = "tsgo is not installed (bun add @typescript/native-preview)"; return null; }
    const root = ctx.fns.procs.project.projectRoot({});
    const proc = Bun.spawn({ cmd: [bin, "--lsp", "--stdio"], cwd: root, stdin: "pipe", stdout: "pipe", stderr: "pipe" });

    let nextId = 0;
    const pending = new Map<number, { resolve: (v: any) => void; reject: (e: Error) => void; timer: ReturnType<typeof setTimeout> }>();
    const write = (msg: unknown) => {
        if (!client.alive) throw new Error("tsgo is not running");
        const body = JSON.stringify({ jsonrpc: "2.0", ...(msg as object) });
        proc.stdin.write(`Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`);
        proc.stdin.flush();
    };

    const client: types.tsgo.Client = {
        pid: proc.pid,
        root,
        bin,
        startedAt: Date.now(),
        alive: true,
        ready: Promise.resolve(),
        request(method, params, timeoutMs = 10_000) {
            return new Promise((resolve, reject) => {
                const id = ++nextId;
                const timer = setTimeout(() => { pending.delete(id); reject(new Error(`tsgo ${method} timed out after ${timeoutMs} ms`)); }, timeoutMs);
                pending.set(id, { resolve, reject, timer });
                try { write({ id, method, params }); } catch (e: any) { clearTimeout(timer); pending.delete(id); reject(e); }
            });
        },
        notify(method, params) { write({ method, params }); },
        async close() {
            if (!client.alive) return;
            try { await client.request("shutdown", null, 2000); client.notify("exit", null); } catch { /* going down anyway */ }
            client.alive = false;
            for (const w of st.watchers ?? []) w.close();
            st.watchers = [];
            proc.kill();
        },
    };

    // Read LSP frames. Server→client requests (configuration, capability
    // registration) get a neutral answer; notifications are ignored — checks
    // pull diagnostics explicitly.
    (async () => {
        let buf = Buffer.alloc(0);
        for await (const chunk of proc.stdout as ReadableStream<Uint8Array>) {
            buf = Buffer.concat([buf, Buffer.from(chunk)]);
            while (true) {
                const headerEnd = buf.indexOf("\r\n\r\n");
                if (headerEnd < 0) break;
                const len = Number(/Content-Length:\s*(\d+)/i.exec(buf.subarray(0, headerEnd).toString())?.[1] ?? NaN);
                if (!Number.isFinite(len)) { buf = buf.subarray(headerEnd + 4); continue; }
                if (buf.length < headerEnd + 4 + len) break;
                let msg: any;
                try { msg = JSON.parse(buf.subarray(headerEnd + 4, headerEnd + 4 + len).toString()); } catch { msg = null; }
                buf = buf.subarray(headerEnd + 4 + len);
                if (!msg) continue;
                if (msg.id != null && !msg.method) {
                    const p = pending.get(msg.id);
                    if (!p) continue;
                    pending.delete(msg.id);
                    clearTimeout(p.timer);
                    if (msg.error) p.reject(new Error(`tsgo: ${msg.error.message ?? JSON.stringify(msg.error)}`));
                    else p.resolve(msg.result);
                } else if (msg.id != null && msg.method) {
                    const result = msg.method === "workspace/configuration" ? (msg.params?.items ?? []).map(() => null) : null;
                    try { write({ id: msg.id, result }); } catch { /* closing */ }
                }
            }
        }
    })().catch(() => {});
    (async () => { for await (const _ of proc.stderr as ReadableStream<Uint8Array>) { /* drain */ } })().catch(() => {});

    proc.exited.then(code => {
        const wasAlive = client.alive;
        client.alive = false;
        for (const p of pending.values()) { clearTimeout(p.timer); p.reject(new Error(`tsgo exited (${code})`)); }
        pending.clear();
        for (const w of st.watchers ?? []) w.close();
        st.watchers = [];
        if (st.client === client) st.client = undefined;
        if (wasAlive) {
            (st.crashes ??= []).push(Date.now());
            st.lastError = `tsgo exited unexpectedly with code ${code}`;
            ctx.fns.procs.log.warn({ event: "tsgo.exited", msg: st.lastError, pid: client.pid });
        }
    });

    client.ready = (async () => {
        await client.request("initialize", {
            processId: process.pid,
            rootUri: "file://" + root,
            workspaceFolders: [{ uri: "file://" + root, name: "project" }],
            capabilities: {
                workspace: { didChangeWatchedFiles: { dynamicRegistration: false } },
                textDocument: { diagnostic: { dynamicRegistration: false }, synchronization: { didSave: false } },
            },
        }, 30_000);
        client.notify("initialized", {});
    })();

    try {
        await client.ready;
    } catch (e: any) {
        st.lastError = `tsgo initialize failed: ${e?.message ?? e}`;
        (st.crashes ??= []).push(Date.now());
        client.alive = false;
        proc.kill();
        return null;
    }

    // Keep tsgo's view of the disk current. It does not watch files itself
    // under --stdio; a change it does not hear about keeps stale types.
    st.pendingChanges = new Map();
    st.watchers = [];
    st.docVersion = 0;
    for (const dir of ["src", "script"]) {
        try {
            const w = watch(join(root, dir), { recursive: true }, (_event, file) => {
                if (!file || !/\.(ts|tsx|d\.ts|js|mjs|json)$/.test(String(file))) return;
                const abs = join(root, dir, String(file));
                if (relative(root, abs).includes("__hyper_virtual_eval__")) return;
                st.pendingChanges!.set(abs, 2);
            });
            st.watchers.push(w);
        } catch { /* directory may not exist */ }
    }

    st.client = client;
    st.lastError = undefined;
    ctx.fns.procs.log.info({ event: "tsgo.started", msg: `pid ${client.pid}`, bin });
    return client;
}
