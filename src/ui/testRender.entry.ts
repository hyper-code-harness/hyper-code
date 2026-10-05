// A ctx for rendering tests, with the REAL component kit wired in.
//
// Every renderer test in this folder used to hand-build its own `ctx` — usually
// `{ fns: { procs: { ui: { escape } } } }`, because escaping was all the
// renderer needed on the day the test was written. Then the renderer started
// calling `procs.ui.button`, and the mock did not: twelve tests in src/ui died
// with "ctx.fns.procs.ui.button is not a function", and stayed dead, because a
// mock cannot fail to keep up with code it does not reference.
//
// So this harness imports the components instead of imitating them. The whole
// kit is wired by its own file name, which is also the registry's rule, so a
// renderer reaching for a component nobody has used in a test yet just works.
//
// The `.entry.ts` suffix is the one the scanner skips outright, so this never
// becomes `ctx.fns.ui.testRender`. A dollar-prefixed name does NOT work here:
// the scanner reads an unrecognised declaration prefix as a malformed runtime
// file and fails the whole reload. It touches no database — a renderer that
// needs one is not a renderer, and belongs in a `testCtx()` test.
import { Glob } from "bun";
import { resolve } from "node:path";

type Fn = (ctx: any, session: any, opts: any) => any;

const KIT_DIRS = ["procs/ui", "ui"] as const;

// Component modules are plain default exports taking (ctx, session, opts); the
// registry's calling convention is opts-only, so each is wrapped once.
function wrap(ctx: any, fn: Fn) {
    return (opts: any = {}) => fn(ctx, ctx.session ?? null, opts);
}

/**
 * Builds a ctx whose component kit is the real one, for renderer tests.
 *
 * Loads every synchronous function under `src/procs/ui` and `src/ui` and exposes it at its registry name, so a test never has to hand-mock `escape`, `button` or a sibling renderer. Use for tests of pure HTML renderers; anything needing the database or routes wants `testCtx()` from `src/$test` instead.
 * @param overrides Functions to install over the real kit, keyed by dotted registry name such as `ui.toggle`.
 */
export async function renderCtx(overrides: Record<string, Fn> = {}): Promise<any> {
    const root = resolve(import.meta.dir, "..");
    const ctx: any = { env: {}, session: null, state: { agent: {}, procs: {} }, fns: {} };

    const install = (dotted: string, fn: Fn) => {
        const parts = dotted.split(".");
        let node = ctx.fns;
        for (const part of parts.slice(0, -1)) node = node[part] ??= {};
        node[parts.at(-1)!] = wrap(ctx, fn);
    };

    for (const dir of KIT_DIRS) {
        const abs = resolve(root, dir);
        const names: string[] = [];
        for await (const rel of new Glob("*.ts").scan(abs)) names.push(rel);
        // Only ordinary functions: `$`-prefixed files are points, hooks,
        // routes and migrations, and a test of one of those is not a render
        // test. `.test.ts` and type files (capitalised) carry no function, and
        // `.entry.ts` is a browser bundle — importing it here asks for `window`.
        const files = names.filter((rel) => !rel.startsWith("$") && !rel.endsWith(".test.ts") && !rel.endsWith(".d.ts") && !rel.endsWith(".entry.ts") && !/^[A-Z]/.test(rel));
        const mod = dir === "procs/ui" ? "procs.ui" : "ui";
        for (const rel of files) {
            const stem = rel.replace(/\.ts$/, "");
            const loaded = await import(resolve(abs, rel));
            if (typeof loaded.default === "function") install(`${mod}.${stem}`, loaded.default);
        }
    }

    // A renderer may log; nothing in a render test should care what it said.
    ctx.fns.procs.log = { info: () => {}, warn: () => {}, error: () => {}, debug: () => {} };
    for (const [dotted, fn] of Object.entries(overrides)) install(dotted, fn);
    return ctx;
}

/**
 * Records every call to one kit function while leaving the real one in place.
 *
 * Returns the recorded `opts` array plus an override entry to pass to `renderCtx`, for tests that assert what a renderer asked for rather than how it looked. Use when the assertion is about arguments, not HTML.
 * @param dotted Registry name to spy on, such as `ui.toggle`.
 * @param impl Implementation to record calls for; its return value is what the renderer sees.
 */
export function spy(dotted: string, impl: Fn): { calls: any[]; override: Record<string, Fn> } {
    const calls: any[] = [];
    return {
        calls,
        override: { [dotted]: (ctx: any, session: any, opts: any) => { calls.push(opts); return impl(ctx, session, opts); } },
    };
}
