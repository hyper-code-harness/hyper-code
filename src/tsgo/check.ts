import { join } from "node:path";

/**
 * Typechecks a snippet of eval code against the project's types in the tsgo language server.
 *
 * The snippet is wrapped exactly like REPL eval code (ctx, session, console,
 * print and the given bindings as parameters) and checked as a virtual document
 * inside src/, so every project type and ctx.fns signature is visible. Nothing
 * is written to disk. Checks are serialized; a warm check takes a few ms and
 * never blocks the event loop. Throws when tsgo is unavailable or times out so
 * the caller can fall back to the in-process checker.
 * @param opts.code Eval source: the body of an async function.
 * @param opts.bindings Extra named values the eval code receives; only their names matter (agent is typed as types.agent.Agent).
 * @param opts.timeoutMs Maximum wait for diagnostics. @default 5000 @minimum 100
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Eval source: the body of an async function. */
        code: string;
        /** Extra named values the eval code receives; only their names matter (agent is typed as types.agent.Agent). */
        bindings?: Record<string, unknown>;
        /** Maximum wait for diagnostics. @default 5000 @minimum 100 */
        timeoutMs?: number;
    },
): Promise<{ ok: boolean; errors: string[]; ms: number }> {
    const st = ((ctx.state as any).tsgo ??= {}) as types.tsgo.State;
    const run = async () => {
        const started = performance.now();
        const client = await ctx.fns.tsgo.server({});
        if (!client) throw new Error(st.lastError ?? "tsgo unavailable");
        await client.ready;

        const bindingParams = Object.keys(opts.bindings ?? {}).map(name => {
            if (!/^[$A-Z_a-z][$\w]*$/.test(name)) throw new TypeError(`eval: invalid binding name ${JSON.stringify(name)}`);
            return `${name}: ${name === "agent" ? "types.agent.Agent" : "any"}`;
        });
        const params = ["ctx: Context", "session: Session | null", "console: Console", "print: (...args: any[]) => void", ...bindingParams];
        const HEADER_LINES = 2;
        const text = `export {};\nasync function __repl(${params.join(", ")}) {\n${opts.code}\n}`;

        // Tell tsgo about files that changed on disk since the last check.
        if (st.pendingChanges?.size) {
            const changes = [];
            for (const [abs] of st.pendingChanges) {
                const exists = await Bun.file(abs).exists();
                changes.push({ uri: "file://" + abs, type: exists ? 2 : 3 });
            }
            st.pendingChanges.clear();
            client.notify("workspace/didChangeWatchedFiles", { changes });
        }

        const uri = "file://" + join(client.root, "src", "__hyper_virtual_eval__.ts");
        st.docVersion = (st.docVersion ?? 0) + 1;
        if (st.docVersion === 1) {
            client.notify("textDocument/didOpen", { textDocument: { uri, languageId: "typescript", version: st.docVersion, text } });
        } else {
            client.notify("textDocument/didChange", { textDocument: { uri, version: st.docVersion }, contentChanges: [{ text }] });
        }
        const report = await client.request("textDocument/diagnostic", { textDocument: { uri } }, Math.max(100, opts.timeoutMs ?? 5000));
        const all = ((report?.items ?? []) as any[]).filter(d => d.severity === 1);
        // Like the in-process checker: when the text does not parse, report only
        // the parse errors — semantic ones on broken code are noise. tsgo tags
        // syntax diagnostics with codes in the 1000–1999 range.
        const syntax = all.filter(d => typeof d.code === "number" && d.code >= 1000 && d.code < 2000);
        const errors = (syntax.length ? syntax : all)
            .map(d => `${Math.max(1, d.range.start.line + 1 - HEADER_LINES)}:${d.range.start.character + 1} ${flatten(d.message)}`);
        const ms = Math.round(performance.now() - started);
        const s = (st.stats ??= { checks: 0, totalMs: 0, maxMs: 0, timeouts: 0, fallbacks: 0 });
        s.checks++; s.totalMs += ms; s.maxMs = Math.max(s.maxMs, ms);
        return { ok: errors.length === 0, errors, ms };
    };
    // One virtual document: checks must not interleave their didChange/diagnostic pairs.
    const next = (st.queue ?? Promise.resolve()).catch(() => {}).then(run);
    st.queue = next.catch(() => {});
    try {
        return await next;
    } catch (e: any) {
        if (/timed out/.test(String(e?.message))) (st.stats ??= { checks: 0, totalMs: 0, maxMs: 0, timeouts: 0, fallbacks: 0 }).timeouts++;
        throw e;
    }
}

function flatten(message: unknown): string {
    return String(message ?? "").replace(/\s*\n\s*/g, " ").trim();
}
