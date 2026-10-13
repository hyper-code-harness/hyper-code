/**
 * Validate declarative plugin providers against the current complete boot snapshot.
 * Singleton loader calls intentionally use boot.entries rather than replacing a registry
 * with a partial scan; listing also reconciles removals when no declarations remain.
 * @param opts.entries Declarations supplied by the boot loader (full or singleton).
 */
export default async function (ctx: Context, _session: Session | null, opts: { entries: Array<{ abs?: string; root?: string; rootDir?: string; kind?: string; name?: string; fn?: unknown }> }): Promise<void> {
    // Full plugin reload uses boot.load. A loader-level singleton may update only
    // a declaration already present in that snapshot, never resurrect a removed file.
    const entries = ctx.state.procs.boot.entries;
    for (const update of opts.entries) {
        const existing = entries.find(e => e.abs === update.abs && (update.root === undefined || e.root === update.root) && (update.rootDir === undefined || e.rootDir === update.rootDir) && e.kind === 'plugin' && e.name === update.name);
        // dev.sync carries classified fields plus abs, not owner fields. Resolve
        // identity only through the existing trusted boot entry before importing.
        if (existing && existing !== update) existing.fn = update.fn ?? (await import(existing.abs + '?provider=' + Date.now())).default;
    }
    await ctx.fns.plugins.providers({});
}
