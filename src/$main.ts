// makeCtx: raw fns live in ctx.state.registry; ctx.fns is a Proxy that injects
// (ctx, ctx.session) into every call — `ctx.fns.notes.add({text})` actually
// calls rawAdd(ctx, ctx.session, {text}). The getter reads `this` throughout,
// so a derived ctx (Object.create + own session / env / state) injects ITSELF:
//   - request ctx: + session {req, params}        → session flows
//   - env ctx (env.fork): + env {NODE_ENV} + fresh state, shared registry
//     → a test environment coexists with dev in the same process
export function makeCtx(): Context {
    const ctx: any = {
        env: { ...process.env },
        state: { serverStart: Date.now(), registry: {}, procs: { boot: {}, http: { routes: {} } } },
        session: null,
    };
    Object.defineProperty(ctx, 'fns', {
        get() { return wrapFns(this, this.state.registry); },
    });
    return ctx as Context;
}

function wrapFns(ctx: any, node: any): any {
    return new Proxy(node, {
        get(target, prop) {
            const v = target[prop as any];
            // Keep procedure dispatch transparent. Telemetry is deliberately
            // installed by hand only at coarse, known-cost boundaries.
            if (typeof v === 'function') return (opts?: any) => v.call(v, ctx, ctx.session, opts);
            if (v && typeof v === 'object') return wrapFns(ctx, v);
            return v;
        },
    });
}

// Derive a child ctx carrying a session — used by the server, http.dispatch and
// tests so request-scoped session construction lives in ONE place. Inherits the
// registry/routes/env; everything the handler calls via rctx.fns.* sees this
// session.
export { makeRequestCtx } from "./procs/boot/requestCtx";

import { resolve } from "node:path";

// Boot the framework for a project rooted at `root` (its src/ holds the app's
// fns; package.json its config). proc's own core src is ALWAYS scanned too, so
// an app gets http/repl/dev/config/lifecycle/… merged with its own code.
// An app does:  import { boot } from "proc"; await boot({ root: import.meta.dir })
export async function boot(opts?: { root?: string }): Promise<Context> {
    const ctx = makeCtx();
    // Default root = proc's own repo root ($main.ts lives in src/). Apps pass theirs.
    ctx.state.root = opts?.root ?? resolve(import.meta.dir, "..");
    const { default: loadFns } = await import("./procs/boot/load");
    await loadFns(ctx, null, {});
    // A project carries its modules in workspace.json, not in its repo: clone
    // the ones that are declared but absent, then mount what arrived.
    const { fetched } = await ctx.fns.procs.modules.fetch({});
    if (fetched.length) await loadFns(ctx, null, {});
    const lint = await ctx.fns.procs.dev.lint({});
    if (!lint.ok) console.error(`[boot] ${lint.errors.length} namespace lint error(s) — fix before building (see [lint] above)`);
    await ctx.fns.procs.dev.genTypes({});
    await ctx.fns.procs.http.loadRoutes({});
    // Run module $start hooks in package.json proc.prod order (db connects,
    // http serves, …). $stop runs in reverse on shutdown.
    await ctx.fns.procs.lifecycle.start({});
    const shutdown = async (sig: string) => {
        console.log(`\n[${sig}] shutting down`);
        await ctx.fns.procs.lifecycle.stop({});
        process.exit(0);
    };
    process.on("SIGINT", () => shutdown("SIGINT"));
    process.on("SIGTERM", () => shutdown("SIGTERM"));
    // A server does not die because somebody else's API said no. Background work
    // — a wake delivery, a watch poll — runs detached, so a
    // provider rejection there had nothing above it to catch: xAI answered 402
    // ("out of credits"), the rejection reached the top, and the whole runtime
    // exited with code 1, taking every agent and the tunnel with it.
    //
    // These handlers log loudly and keep serving. They are deliberately NOT a
    // way to ignore bugs: the message carries the full error so the cause stays
    // visible, and anything that must fail a request still fails it.
    process.on("unhandledRejection", (reason: any) => {
        const detail = reason?.stack ?? reason?.message ?? String(reason);
        console.error(`[unhandledRejection] ${detail}`);
    });
    process.on("uncaughtException", (error: any) => {
        console.error(`[uncaughtException] ${error?.stack ?? error?.message ?? String(error)}`);
    });
    // Watch in dev by default; WATCH=0 opts out, prod never watches.
    if (ctx.fns.procs.env.mode({}) === "dev" && ctx.env.WATCH !== "0") await ctx.fns.procs.dev.watch({});
    return ctx;
}

export default boot;

// Boot just the registry (no genTypes / routes / server / lifecycle) — for CLI
// commands and one-off scripts that only need ctx.fns.
export async function bootRegistry(opts?: { root?: string }): Promise<Context> {
    const ctx = makeCtx();
    ctx.state.root = opts?.root ?? resolve(import.meta.dir, "..");
    const { default: loadFns } = await import("./procs/boot/load");
    const log = console.log;
    console.log = () => {}; // quiet the [fns] load chatter (CLI output stays clean)
    try { await loadFns(ctx, null, {}); } finally { console.log = log; }
    return ctx;
}

if (import.meta.main) {
    const ctx = await boot();
    (globalThis as any).ctx = ctx;
}
