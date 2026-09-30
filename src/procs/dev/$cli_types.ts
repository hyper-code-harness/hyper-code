// `bun script/cli.ts types` — write src/ctx_ns.d.ts from the project scan.
//
// The file is generated, not authored: boot regenerates it, and the dev watcher
// regenerates it on every add or rename. It exists so that a fresh checkout can
// type-check BEFORE anything boots — CI needs it, and so does an editor opened
// on a clone that has never been run.
//
// This command boots the registry only: no database, no HTTP server, no
// lifecycle hooks. It must stay that way, or CI cannot use it.

/**
 * Regenerates the `src/ctx_ns.d.ts` ambient type declarations.
 *
 * Scans the project and writes the `ctx.fns`, `types.*` and state declarations
 * that make every runtime function typed at its call site. Run it after a fresh
 * clone, or whenever the file is missing, before `tsc`; boot and the dev watcher
 * do it automatically during development.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    _opts?: Record<string, never>,
): Promise<{ modules: number; types: number }> {
    const result = await ctx.fns.procs.dev.genTypes({});
    console.log(`src/ctx_ns.d.ts — ${result.modules} modules, ${result.types} types`);
    return { modules: result.modules, types: result.types };
}
