/**
 * Searches the plugin listing and tells, per plugin, whether it is installed, which release is newest and whether an update exists
 *
 * Use to find a plugin to install by capability words ("charts", "sql", "diagrams") or to see what can be updated.
 * Reads every configured listing (plugins.listing; each entry names its listing), asks each repository for its vX.Y.Z tags (plugins.versions, cached) and compares with the
 * PLUGIN_HOST package: `installed` is the installed version, `update` is true when a newer tag exists, `providedBy`
 * names a module mounted from elsewhere that already owns the name. Install with plugins.install({ name }).
 * @param opts.q Words matched against name, label and description; omit for every plugin.
 * @param opts.fresh Re-read the tags instead of using the few-minute cache. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Words matched against name, label and description; omit for every plugin. */
    q?: string;
    /** Re-read the tags instead of using the few-minute cache. @default false */
    fresh?: boolean;
}): Promise<{ urls: string[]; plugins: types.plugins.CatalogEntry[]; errors: string[]; host: string | null }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { urls, plugins, errors } = await ctx.fns.plugins.listing({});
    const words = String(opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const matching = plugins.filter(p => words.every(w => `${p.name} ${p.label} ${p.description}`.toLowerCase().includes(w)));
    const configured = String(ctx.env.PLUGIN_HOST ?? '').trim();
    const host = configured ? path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir()))) : null;
    const deps: Record<string, string> = host
        ? JSON.parse(await fs.readFile(path.join(host, 'package.json'), 'utf8').catch(() => '{}')).dependencies ?? {} : {};
    const realHost = host ? await fs.realpath(path.join(host, 'node_modules')).catch(() => path.join(host, 'node_modules')) : '';
    const modules = ctx.state.procs.modules ?? [];
    const newer = (a: string, b: string) => {
        const x = a.split('.').map(Number), y = b.split('.').map(Number);
        return (x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!) > 0;
    };
    const out = await Promise.all(matching.map(async (p): Promise<types.plugins.CatalogEntry> => {
        const entry: types.plugins.CatalogEntry = { ...p, update: false };
        try {
            const latest = (await ctx.fns.plugins.versions({ source: p.source, fresh: opts.fresh === true }))[0];
            if (latest) entry.latest = latest.version; else entry.error = 'no vX.Y.Z release tag';
        } catch (e) { entry.error = e instanceof Error ? e.message : 'releases unavailable'; }
        if (deps[p.name]) {
            entry.spec = deps[p.name];
            const pkg = await fs.readFile(path.join(host!, 'node_modules', p.name, 'package.json'), 'utf8').then(JSON.parse, () => null);
            if (typeof pkg?.version === 'string') entry.installed = pkg.version;
            if (Array.isArray(pkg?.procs?.requires)) entry.requires = pkg.procs.requires.map(String);
            entry.update = !!(entry.latest && entry.installed && newer(entry.latest, entry.installed));
        } else {
            for (const m of modules.filter(m => m.name === p.name || m.namespaces.includes(p.name))) {
                const owner = await fs.realpath(m.dir).catch(() => m.dir);
                if (!realHost || !owner.startsWith(realHost + '/')) { entry.providedBy = `${m.source ?? 'runtime'} module ${m.name}`; break; }
            }
        }
        return entry;
    }));
    return { urls, plugins: out, errors, host };
}
