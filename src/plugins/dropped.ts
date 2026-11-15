/**
 * Lists the plugins a Hyper update would take away, or has taken away: mounted from the Hyper tree before, no longer in it after
 *
 * Use before and after updating Hyper. A plugin that used to ship inside the Hyper repository (`plugins/<name>`) and
 * has since moved to its own repository is not mounted any more after the update — its functions, pages and
 * Markdown blocks disappear without an error — until it is installed from the catalog. With `from` and `to` it
 * compares two commits of this checkout (what an update from `from` to `to` drops); without them it takes the last
 * update — the commit of the previous start against the running one (plugins.noteUpdate), so an update made from
 * outside with git counts too — and answers with what is still missing. For each plugin it says whether this Hyper mounted
 * it before the update (`mounted`: shipped as always-on, or named in package.json or workspace.json modules),
 * whether a clone in USER_PLUGINS provides it now (`installed`), and the catalog release that brings it back
 * (`latest`, when a listing has it). Reads git and files of this checkout and the catalog; changes nothing.
 * @param opts.from Commit the checkout is updated from; with `to`. Omit both to read the last recorded update.
 * @param opts.to Commit the checkout is updated to.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Commit the checkout is updated from; with `to`. Omit both to read the last recorded update. */
    from?: string;
    /** Commit the checkout is updated to. */
    to?: string;
}): Promise<{
    /** The two commits compared; null when there is no recorded update and none was given. */
    from: string | null; to: string | null;
    plugins: Array<{ name: string; label: string; mounted: boolean; installed: boolean; latest?: string }>;
    /** Those of `plugins` this Hyper used and nothing provides now: what the person should install. */
    missing: string[];
}> {
    const path = await import('node:path');
    const fs = await import('node:fs/promises');
    const root = ctx.fns.procs.project.projectRoot({});
    let from = opts.from?.trim() || null, to = opts.to?.trim() || null;
    if (!from || !to) {
        // The last update, whatever performed it: plugins.noteUpdate compares the running commit with the one of the
        // previous start. Before the first such record exists, what the supervisor wrote after "Update and restart".
        const runtime = ctx.fns.procs.project.runtimeDir({});
        const note = await fs.readFile(path.join(runtime, 'plugins-head.json'), 'utf8').then(JSON.parse, () => null);
        const receipt = await fs.readFile(path.join(runtime, 'update-result.json'), 'utf8').then(JSON.parse, () => null);
        if (typeof note?.previous === 'string' && typeof note?.head === 'string') { from = note.previous; to = note.head; }
        else if (receipt?.ok && typeof receipt.old === 'string' && typeof receipt.target === 'string') { from = receipt.old; to = receipt.target; }
        else return { from: null, to: null, plugins: [], missing: [] };
    }
    if (!/^[0-9a-f]{7,64}$/i.test(from!) || !/^[0-9a-f]{7,64}$/i.test(to!)) throw new Error('from and to must be commit SHAs');
    const git = async (args: string[]) => (await ctx.fns.git.run({ args, dir: root, host: 'local', allowFailure: true }));
    const dirs = async (commit: string) => {
        const r = await git(['ls-tree', '-d', '--name-only', commit, 'plugins/']);
        return r.ok ? r.stdout.split('\n').map(l => l.replace(/^plugins\//, '').trim()).filter(Boolean) : [];
    };
    const json = async (spec: string) => { const r = await git(['show', spec]); try { return r.ok ? JSON.parse(r.stdout) : null; } catch { return null; } };
    const [before, after] = [await dirs(from!), new Set(await dirs(to!))];
    // A folder with only leftovers (node_modules) is not a plugin: the manifest decides.
    const gone: Array<{ name: string; manifest: any }> = [];
    for (const name of before) {
        const manifest = await json(`${from}:plugins/${name}/package.json`);
        if (!manifest?.procs) continue;
        if (after.has(name) && (await json(`${to}:plugins/${name}/package.json`))?.procs) continue;
        gone.push({ name, manifest });
    }
    if (!gone.length) return { from, to, plugins: [], missing: [] };

    // What this Hyper mounted before: always-on plugins, and the optional ones its two module lists named.
    const named = new Set<string>();
    const collect = (o: unknown) => {
        if (!o || typeof o !== 'object') return;
        for (const [k, v] of Object.entries(o as Record<string, unknown>)) {
            if (k === 'modules' && v && typeof v === 'object') for (const [n, cfg] of Object.entries(v as Record<string, unknown>)) { if (cfg !== false) named.add(n); }
            else collect(v);
        }
    };
    collect((await json(`${from}:package.json`))?.procs);
    collect(await fs.readFile(path.join(ctx.fns.procs.project.workdir({}), 'workspace.json'), 'utf8').then(JSON.parse, () => null));
    const everything = named.has('*');

    const user = String(ctx.env.USER_PLUGINS ?? '').trim().replace(/^~(?=\/)/, String(ctx.env.HOME ?? ''));
    const clone = async (name: string) => !!user && await fs.stat(path.join(user, name, 'package.json')).then(() => true, () => false);
    const listed = await ctx.fns.plugins.listing({}).then(l => new Map(l.plugins.map(p => [p.name, p])), () => new Map<string, types.plugins.ListingEntry>());
    const plugins = [];
    for (const { name, manifest } of gone) {
        const entry = listed.get(name);
        const latest = entry ? await ctx.fns.plugins.versions({ source: entry.source }).then(v => v[0]?.version, () => undefined) : undefined;
        plugins.push({
            name,
            label: String(manifest.procs.label ?? name),
            mounted: manifest.procs.optional !== true || everything || named.has(name),
            installed: await clone(name),
            ...(latest ? { latest } : {}),
        });
    }
    return { from, to, plugins, missing: plugins.filter(p => p.mounted && !p.installed).map(p => p.name) };
}
