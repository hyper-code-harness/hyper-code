/**
 * Searches the plugin listing and tells, per plugin, whether it is installed, which release is newest and whether an update exists
 *
 * Use to find a plugin to install by capability words ("charts", "sql", "diagrams") or to see what can be updated.
 * Reads every configured listing (plugins.listing; each entry names its listing), asks each repository for its vX.Y.Z tags (plugins.versions, cached) and compares with the
 * git clones in USER_PLUGINS recorded in the plugin lock: `installed` is the installed version, `tag` the release the
 * clone was installed at, `update` is true when a newer tag exists, `providedBy` names a module mounted from
 * elsewhere that already owns the name. Install with plugins.install({ name }).
 * @param opts.q Words matched against name, label and description; omit for every plugin.
 * @param opts.fresh Re-read the tags instead of using the few-minute cache. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Words matched against name, label and description; omit for every plugin. */
    q?: string;
    /** Re-read the tags instead of using the few-minute cache. @default false */
    fresh?: boolean;
}): Promise<{ urls: string[]; plugins: types.plugins.CatalogEntry[]; errors: string[]; mount: string | null }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { urls, plugins, errors } = await ctx.fns.plugins.listing({});
    const words = String(opts.q ?? '').toLowerCase().split(/\s+/).filter(Boolean);
    const matching = plugins.filter(p => words.every(w => `${p.name} ${p.label} ${p.description}`.toLowerCase().includes(w)));
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    const mount = configured ? path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir()))) : null;
    const lock = mount ? (await ctx.fns.plugins.lockFile({}).catch(() => null))?.lock.plugins ?? {} : {};
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
        if (lock[p.name] && mount) {
            entry.tag = lock[p.name]!.tag;
            const pkg = await fs.readFile(path.join(mount, p.name, 'package.json'), 'utf8').then(JSON.parse, () => null);
            if (typeof pkg?.version === 'string') entry.installed = pkg.version;
            if (Array.isArray(pkg?.procs?.requires)) entry.requires = pkg.procs.requires.map(String);
            entry.update = !!(entry.latest && newer(entry.latest, entry.tag.slice(1)));
            const st = await ctx.fns.plugins.cloneStatus({ dir: path.join(mount, p.name) }).catch(() => null);
            if (st?.git && st.commit) {
                const { git: _g, ...rest } = st;
                const norm = (u: string) => u.replace(/^git\+/, '').replace(/^github:/, 'https://github.com/').replace(/^file:\/\//, '').replace(/\.git$/, '').toLowerCase();
                entry.git = { ...rest, commit: st.commit, lockedTag: lock[p.name]!.tag, fork: !!(st.upstream || (st.origin && norm(st.origin) !== norm(lock[p.name]!.repo))) };
            }
        } else {
            const m = modules.find(m => m.name === p.name || m.namespaces.includes(p.name));
            if (m) entry.providedBy = `${m.source ?? 'runtime'} module ${m.name}`;
        }
        return entry;
    }));
    return { urls, plugins: out, errors, mount };
}
