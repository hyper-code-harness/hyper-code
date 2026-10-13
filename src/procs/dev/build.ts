// Production build: freeze the runtime-discovered registry into a static
// import manifest, then Bun.build collapses every namespace + all deps into
// ONE self-contained file (dist/app.js). No src/ scan, no dynamic import, no
// genTypes/watch/repl at boot — just import the registry and serve.
//   ctx.fns.procs.dev.build({})           → dist/app.js
//   bun dist/app.js                 → runs standalone, anywhere
const MAIN_TEMPLATE = `// AUTO-GENERATED prod entry - Bun.build bundles this + everything it imports.
import { makeCtx } from "procs";
import { apply } from "procs/boot";
import { entries, modules, startOrder } from "./manifest";

const ctx = makeCtx();
ctx.env.NODE_ENV = ctx.env.NODE_ENV ?? "production"; // disables /repl, error stacks

// The SAME code the dev boot runs, over a list that was baked instead of
// scanned: every file already imported, every kind loaded by its own loader.
// apply() already handed every file to its loader, routes included. Calling
// loadRoutes here would rebuild the table from a scan of a filesystem the bundle
// does not have — which is exactly how a bundle used to serve the framework's
// routes and none of the app's.
// Remember the baked list: when this process later mounts something at runtime
// (the project a workspace supervises), boot.load adds to this instead of
// replacing it with the handful a scan can find inside a bundle.
(((ctx.state as any).procs ??= {}).boot ??= {}).baked = entries;
await apply(ctx, entries, modules);

// Run $start hooks in the baked order (db, http, ...), $stop in reverse on exit.
ctx.state.procs.lifecycle = { started: [] };
for (const mod of startOrder) {
    const e = entries.find((d) => d.kind === "lifecycle" && d.moduleDir === mod && d.hook === "start");
    if (!e) continue;
    const st = await e.fn(ctx, null, {});
    if (st && typeof st === "object") Object.assign((ctx.state[mod] ??= {}), st);
    ctx.state.procs?.lifecycle.started.push(mod);
}
const stop = async () => {
    for (const mod of [...ctx.state.procs?.lifecycle.started].reverse()) {
        const e = entries.find((d) => d.kind === "lifecycle" && d.moduleDir === mod && d.hook === "stop");
        if (e) try { await e.fn(ctx, null, ctx.state[mod]); } catch {}
    }
};
process.on("SIGINT", () => stop().then(() => process.exit(0)));
process.on("SIGTERM", () => stop().then(() => process.exit(0)));
`;

/**
 * Builds a static production executable from the legacy runtime composition.
 * Explicit pluginRegistry requires the source runtime and is rejected before build output is written.
 * @param opts.outdir Destination directory for the compiled executable. @default dist
 */
export default async function (ctx: Context, _session: Session | null, opts?: { outdir?: string }) {
    if (await ctx.fns.procs.modules.readPluginRegistry({})) {
        throw new Error("Static build does not support pluginRegistry; use the source runtime or legacy composition");
    }
    // Never ship a bundle with name collisions / invalid names.
    const lint = await ctx.fns.procs.dev.lint({});
    if (!lint.ok) throw new Error(`build aborted — lint failed:\n` + lint.errors.map((e) => "  ✗ " + e).join("\n"));

    const m = await ctx.fns.procs.dev.manifest({ out: ".runtime/build/manifest.ts" });
    await Bun.write(".runtime/build/main.ts", MAIN_TEMPLATE);

    const outdir = opts?.outdir ?? "dist";
    const built = await Bun.build({
        entrypoints: [".runtime/build/main.ts"],
        outdir,
        naming: "app.js",
        target: "bun",
        minify: true,
        sourcemap: "none",
    });
    if (!built.success) throw new Error(built.logs.map((l) => l.message).join("\n"));
    const bytes = Bun.file(outdir + "/app.js").size;
    return { ...m, bundle: outdir + "/app.js", kb: Math.round(bytes / 102.4) / 10, success: true };
}
