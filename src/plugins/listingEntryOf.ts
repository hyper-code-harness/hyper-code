/**
 * Builds the listing entry of a local plugin from its own package.json: name, label, icon, description and the repository it is published to
 *
 * Use where an entry is written to or compared with a plugin listing (plugins.publish, plugins.addToListing): one
 * place decides what a listing says about a plugin. The label, the ph-* icon and the one-sentence description come
 * from `procs` of the plugin's package.json; a plugin without `procs.description` is refused, because a catalog entry
 * without one tells nobody what the plugin does. `publishedBy`, when given, records who published it.
 * @param opts.name Plugin name (folder under USER_PLUGINS).
 * @param opts.source The plugin's repository in canonical form (plugins.repoUrl source).
 * @param opts.publishedBy Who publishes it, recorded in the entry (plugins.home gives it).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name (folder under USER_PLUGINS). */
    name: string;
    /** The plugin's repository in canonical form (plugins.repoUrl source). */
    source: string;
    /** Who publishes it, recorded in the entry (plugins.home gives it). */
    publishedBy?: string;
}): Promise<{ name: string; label: string; icon?: string; description: string; source: string; publishedBy?: string }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const { dir } = await ctx.fns.plugins.cloneDir({ name: opts.name });
    const pkg = JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8'));
    const procs = pkg.procs ?? {};
    const entry = {
        name: opts.name,
        label: String(procs.label ?? opts.name),
        ...(typeof procs.icon === 'string' && /^ph-[a-z0-9-]+$/.test(procs.icon) ? { icon: procs.icon as string } : {}),
        description: String(procs.description ?? ''),
        source: opts.source,
        ...(opts.publishedBy ? { publishedBy: opts.publishedBy.slice(0, 200) } : {}),
    };
    if (!entry.description) throw new Error(`${opts.name} has no procs.description in package.json: the catalog needs one sentence about what it does`);
    return entry;
}
