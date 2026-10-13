/**
 * Lists mounted local plugins with package display metadata for read-only discovery.
 *
 * Reads package.json only: repository folders, dependencies and package scripts do not
 * invalidate an existing mount. Revisions identify displayed metadata, not installable
 * content snapshots; materialization deliberately rejects these discovery selections.
 * @param opts.q Case-insensitive filter over plugin identity, label and description.
 * @param opts.limit Maximum returned selections. @default 30 @minimum 1 @maximum 100
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Case-insensitive filter over identity, label and description. */
        q?: string;
        /** Maximum returned selections. @default 30 @minimum 1 @maximum 100 */
        limit?: number;
    },
): Promise<types.plugins.ProviderSearchResult> {
    const fs = await import('node:fs/promises');
    const { createHash } = await import('node:crypto');
    const items: types.plugins.ProviderItem[] = [];
    const errors: string[] = [];
    const seen = new Set<string>();
    const q = (opts.q ?? '').trim().toLowerCase();
    const text = (value: types.plugins.LifecycleJson | undefined, fallback: string) => typeof value === 'string' && value.trim() ? value.trim() : fallback;
    for (const module of ctx.state.procs.modules) {
        if (module.self) continue;
        try {
            const dir = await fs.realpath(module.dir);
            if (seen.has(dir)) continue;
            seen.add(dir);
            const pkg = await ctx.fns.plugins.readMetadata({ path: dir + '/package.json' });
            const procs = pkg.procs && typeof pkg.procs === 'object' && !Array.isArray(pkg.procs) ? pkg.procs : {};
            const label = text(procs.label, module.label || module.name);
            const description = text(procs.description, text(pkg.description, module.description || ''));
            if (q && ![module.name, label, description].some(value => value.toLowerCase().includes(q))) continue;
            const revision = 'mounted:' + createHash('sha256').update(JSON.stringify(pkg)).digest('hex');
            items.push({
                selection: { provider: 'filesystem', name: module.name, revision, source: { path: dir } },
                label, ...(description ? { description } : {}), icon: text(procs.icon, module.icon || 'ph-puzzle-piece'),
                ...(text(pkg.version, '') ? { version: text(pkg.version, '') } : {}),
            });
        } catch (error) {
            errors.push(module.name + ': ' + (error instanceof Error ? error.message : 'Local metadata unavailable'));
        }
        if (items.length >= Math.max(1, Math.min(100, opts.limit ?? 30))) break;
    }
    return { items, errors: errors.slice(0, 100) };
}
