/**
 * Installs or updates a plugin from the listing by name, together with the plugins it requires
 *
 * Use when an agent or the UI wants a listed plugin: give its name (and optionally a version), get a preview of what
 * bun will install — the plugin, every plugin it needs through procs.requires that is not mounted yet (resolved from
 * the listing at their newest release, transitively), files, packages and conflicts. Nothing changes until the same
 * call is repeated with confirmed:true and the preview's digest. An installed plugin is updated to the requested or
 * newest release. Plugins it needs that are not in the listing make the preview fail with their names.
 * @param opts.name Plugin name from plugins.catalog.
 * @param opts.version Release to install, e.g. 1.2.0; defaults to the newest vX.Y.Z tag.
 * @param opts.confirmed Apply the previewed change. @default false
 * @param opts.expectedDigest Digest of the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name from plugins.catalog. */
    name: string;
    /** Release to install, e.g. 1.2.0; defaults to the newest vX.Y.Z tag. */
    version?: string;
    /** Apply the previewed change. @default false */
    confirmed?: boolean;
    /** Digest of the preview being confirmed. */
    expectedDigest?: string;
}): Promise<types.plugins.HostChange> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { plugins } = await ctx.fns.plugins.listing({});
    const release = async (name: string, version?: string) => {
        const entry = plugins.find(p => p.name === name);
        if (!entry) throw new Error(`${name} is not in the plugin listing`);
        const tags = await ctx.fns.plugins.versions({ source: entry.source });
        const tag = version ? tags.find(t => t.version === version.replace(/^v/, '')) : tags[0];
        if (!tag) throw new Error(version ? `${name} has no release ${version}` : `${name} has no vX.Y.Z release`);
        return { entry, tag, spec: `${entry.source}#${tag.tag}` };
    };
    const main = await release(opts.name, opts.version);

    // procs.requires of the release, read from its package.json at that tag, without installing anything.
    const requiresOf = async (source: string, tag: string, commit: string): Promise<string[]> => {
        let pkg: any = null;
        if (source.startsWith('github:')) {
            const res = await fetch(`https://raw.githubusercontent.com/${source.slice(7)}/${commit}/package.json`, { signal: AbortSignal.timeout(15000) });
            if (res.ok) pkg = await res.json();
        } else {
            const p = Bun.spawnSync(['git', 'show', `${tag}:package.json`], { cwd: new URL(source.slice(4)).pathname });
            if (!p.exitCode) pkg = JSON.parse(p.stdout.toString());
        }
        if (!pkg) throw new Error(`Could not read package.json of ${source}#${tag}`);
        return Array.isArray(pkg.procs?.requires) ? pkg.procs.requires.map(String) : [];
    };
    const configured = String(ctx.env.PLUGIN_HOST ?? '').trim();
    if (!configured) throw new Error('PLUGIN_HOST is not configured');
    const host = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const deps: Record<string, string> = JSON.parse(await fs.readFile(path.join(host, 'package.json'), 'utf8').catch(() => '{}')).dependencies ?? {};
    const mounted = (n: string) => !!deps[n] || (ctx.state.procs.modules ?? []).some(m => m.name === n || m.namespaces.includes(n));
    const companions: Record<string, string> = {};
    const queue = await requiresOf(main.entry.source, main.tag.tag, main.tag.commit);
    while (queue.length) {
        const need = queue.shift()!;
        if (need === opts.name || companions[need] || mounted(need)) continue;
        const dep = await release(need).catch(() => { throw new Error(`${opts.name} requires ${need}, which is neither installed nor in the listing`); });
        companions[need] = dep.spec;
        queue.push(...await requiresOf(dep.entry.source, dep.tag.tag, dep.tag.commit));
    }
    return await ctx.fns.plugins.bunInstall({
        operation: deps[opts.name] ? 'update' : 'install',
        spec: main.spec,
        name: opts.name,
        ...(Object.keys(companions).length ? { with: companions } : {}),
        ...(opts.confirmed ? { confirmed: true, expectedDigest: opts.expectedDigest ?? '' } : {}),
    });
}
