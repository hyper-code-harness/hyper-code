// Centralised test context — boots the REAL procs registry (full ctx.fns via
// the injecting Proxy, :memory: db, migrations applied), then stubs the slow /
// non-deterministic fns the way tests expect. `.entry.ts` is skipped by the
// scanner, so this file never registers as a fn.
//
// Usage:
//   import { mkTestCtx } from '../_testCtx.entry';
//   const ctx = await mkTestCtx();                       // :memory: db
//   const agent = ctx.fns.agent.start({ model: 'mock:echo' });
//
// Stubs (override per-test by assigning into ctx.state.registry.<mod>.<fn>,
// signatures are raw `(ctx, session, opts)`):
//   markdown.highlight — HTML-escape only (no shiki)
//   markdown.render    — identity (source in, source out)
//   repl.eval          — echoes 'ok' ('2+2' → 4); real eval available as
//                        ctx.fns.procs.repl.eval
import { testCtx } from "./$test";

export async function mkTestCtx(opts: { db?: string | false; env?: Record<string, string> } = {}): Promise<any> {
    const ctx: any = await testCtx({
        env: {
            ...(typeof opts.db === "string" ? { DATABASE_URL: opts.db } : {}),
            ...opts.env,
        },
    });

    // Deterministic env: makeCtx spreads process.env, and `bun test` auto-loads
    // .env/.env.test (MODEL, LMSTUDIO_URL, API keys…) — that would flip settings
    // provenance from "default" to "env" depending on the machine. Config is
    // read lazily off ctx.env, so replacing it here is enough.
    ctx.env = {
        NODE_ENV: "test",
        LOG_LEVEL: "warn",
        ...(typeof opts.db === "string" ? { DATABASE_URL: opts.db } : {}),
        ...opts.env,
    };

    // The product default of the global status line injects an extra user row into every turn; tests that
    // count transcript rows must not depend on it. Tests of the status line set it explicitly.
    const settingsRegistry = ctx.state.settings?.registry;
    const statusLine = settingsRegistry?.get("agent.globalStatusLine");
    if (statusLine) settingsRegistry.set("agent.globalStatusLine", { ...statusLine, default: "" });

    const reg = ctx.state.registry;
    reg.markdown.highlight = async (_c: any, _s: any, o: any) =>
        String(o?.code ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
    reg.markdown.render = async (_c: any, _s: any, o: { source: string }) => o.source;
    reg.repl.eval = async (_c: any, _s: any, o: { code: string }) => (o.code === "2+2" ? 4 : "ok");

    return ctx;
}
