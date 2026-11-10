/**
 * Installs, updates, removes or rolls back a plugin of the PLUGIN_HOST package through bun
 *
 * Use for plugins distributed as their own package (a GitHub repo, a registry name, a .tgz or a folder). The first
 * call is a preview: bun runs `add`/`remove` with scripts disabled in a temporary copy of the host, the staged package
 * is checked with plugins.inspectPackage, its namespaces are checked against every other mounted module, plugins it requires (procs.requires) must be mounted or
 * added in the same step (opts.with) and a plugin another installed one requires cannot be removed, and the
 * file diff against the installed copy plus a digest are returned; the live host is not touched. Repeating the call
 * with confirmed:true and that digest swaps the staged host in, keeps the previous package.json and bun.lock in
 * .history for rollback, and remounts plugins. Rollback restores the latest history entry and lets bun reproduce it
 * from the lock. Migrations a plugin ran and other external effects are not undone.
 * @param opts.operation install, update (same as install for an already installed name), remove or rollback.
 * @param opts.spec bun dependency spec, e.g. github:owner/repo#<commit>; required for install and update.
 * @param opts.name Plugin name; required for remove, checked against the package for install and update.
 * @param opts.with Other plugins to add in the same step, name → bun spec: the plugins `spec` requires (plugins.install fills it).
 * @param opts.confirmed Apply the previewed change. @default false
 * @param opts.expectedDigest Digest returned by the preview being confirmed.
 */
export default async function (ctx: Context, session: Session | null, opts: {
    /** install, update (same as install for an already installed name), remove or rollback. */
    operation: 'install' | 'update' | 'remove' | 'rollback';
    /** bun dependency spec, e.g. github:owner/repo#<commit>; required for install and update. */
    spec?: string;
    /** Plugin name; required for remove, checked against the package for install and update. */
    name?: string;
    /** Other plugins to add in the same step, name → bun spec: the plugins `spec` requires (plugins.install fills it). */
    with?: Record<string, string>;
    /** Apply the previewed change. @default false */
    confirmed?: boolean;
    /** Digest returned by the preview being confirmed. */
    expectedDigest?: string;
}): Promise<types.plugins.HostChange> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { createHash } = await import('node:crypto');
    const configured = String(ctx.env.PLUGIN_HOST ?? '').trim();
    if (!configured) throw new Error('PLUGIN_HOST is not configured');
    const host = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const exists = (p: string) => fs.lstat(p).then(() => true, () => false);
    const STATE = ['package.json', 'bun.lock'];
    const readDeps = async (dir: string): Promise<Record<string, string>> =>
        JSON.parse(await fs.readFile(path.join(dir, 'package.json'), 'utf8').catch(() => '{}')).dependencies ?? {};
    const lockLine = (lock: string, name: string) => lock.split('\n').map(l => l.trim()).find(l => l.startsWith(`"${name}": ["`))?.slice(0, 600);
    const bun = async (cwd: string, args: string[]) => {
        const p = Bun.spawn([process.execPath, ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUN_BE_BUN: '1' } });
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        if (code) throw new Error(`bun ${args[0]} failed: ${(err.trim().split('\n').at(-1) ?? '').slice(0, 300)}`);
        return out + err;
    };
    const { operation } = opts;
    if (!['install', 'update', 'remove', 'rollback'].includes(operation)) throw new Error('Unsupported operation');
    if ((operation === 'install' || operation === 'update') && (!opts.spec || opts.spec.length > 500 || /\s/.test(opts.spec)))
        throw new Error('A bun spec is required');
    if (opts.name !== undefined && !/^[a-z][a-z0-9-]{0,63}$/.test(opts.name)) throw new Error('Invalid plugin name');
    const extra = Object.entries(opts.with ?? {});
    if (extra.length && operation !== 'install' && operation !== 'update') throw new Error('with is only for install and update');
    for (const [n, spec] of extra)
        if (!/^[a-z][a-z0-9-]{0,63}$/.test(n) || typeof spec !== 'string' || !spec || spec.length > 500 || /\s/.test(spec)) throw new Error('Invalid with entry: ' + n);

    await fs.mkdir(host, { recursive: true });
    if (!await exists(path.join(host, 'package.json')))
        await fs.writeFile(path.join(host, 'package.json'), JSON.stringify({ name: 'hyper-plugins', private: true }, null, 2) + '\n');
    const lockDir = path.join(host, '.operation-lock');
    await fs.mkdir(lockDir).catch(() => { throw new Error('Another plugin operation is running'); });
    const stage = await fs.mkdtemp(path.join(os.tmpdir(), 'plugin-host-'));
    try {
        for (const f of STATE) if (await exists(path.join(host, f))) await fs.cp(path.join(host, f), path.join(stage, f));
        if (await exists(path.join(host, 'node_modules')))
            await fs.cp(path.join(host, 'node_modules'), path.join(stage, 'node_modules'), { recursive: true, verbatimSymlinks: true });
        const before = await readDeps(host);
        let log = '';
        let history: string | undefined;
        if (operation === 'install' || operation === 'update') log = await bun(stage, ['add', '--ignore-scripts', opts.spec!, ...extra.map(([, spec]) => spec)]);
        else if (operation === 'remove') {
            if (!opts.name || !before[opts.name]) throw new Error('Plugin is not installed: ' + (opts.name ?? ''));
            log = await bun(stage, ['remove', '--ignore-scripts', opts.name]);
        } else {
            const root = path.join(host, '.history');
            history = (await fs.readdir(root).catch(() => [] as string[])).filter(n => /^\d+$/.test(n)).sort().at(-1);
            if (!history) throw new Error('Nothing to roll back to');
            for (const f of STATE) {
                if (await exists(path.join(root, history, f))) await fs.cp(path.join(root, history, f), path.join(stage, f));
                else await fs.rm(path.join(stage, f), { force: true });
            }
            await fs.rm(path.join(stage, 'node_modules'), { recursive: true, force: true });
            log = await bun(stage, ['install', '--ignore-scripts', ...(await exists(path.join(stage, 'bun.lock')) ? ['--frozen-lockfile'] : [])]);
        }
        const after = await readDeps(stage);
        const touched = [...new Set([...Object.keys(before), ...Object.keys(after)])].filter(n => before[n] !== after[n]);
        const companions = extra.map(([n]) => n);
        const main = touched.filter(n => !companions.includes(n));
        const name = opts.name ?? (main.length === 1 ? main[0] : undefined);
        if (!name) throw new Error(main.length ? 'The change touches several plugins: ' + main.join(', ') : 'Nothing changes');
        if (main.some(n => n !== name)) throw new Error('The change touches other plugins too: ' + main.join(', '));
        if (companions.includes(name)) throw new Error('with must not repeat the plugin itself');
        const added: types.plugins.PackageInspection[] = [];
        for (const n of companions) {
            if (!after[n]) throw new Error(`${n} was not added`);
            const inspected = await ctx.fns.plugins.inspectPackage({ dir: path.join(stage, 'node_modules', n) });
            if (inspected.name !== n) throw new Error(`Package name ${inspected.name} does not match dependency ${n}`);
            added.push(inspected);
        }
        const pluginDir = path.join(stage, 'node_modules', name);
        const plugin = after[name] ? await ctx.fns.plugins.inspectPackage({ dir: pluginDir }) : undefined;
        if (plugin && plugin.name !== name) throw new Error(`Package name ${plugin.name} does not match dependency ${name}`);
        if (operation === 'install' && before[name]) throw new Error(name + ' is already installed; use update');
        // Namespaces owned by any other mounted module stay theirs: no silent override.
        const installedDir = path.join(host, 'node_modules', name);
        for (const p of [...(plugin ? [plugin] : []), ...added]) {
            const own = path.join(host, 'node_modules', p.name);
            const real = await fs.realpath(own).catch(() => own);
            const claimed = [...(plugin ? [plugin] : []), ...added].filter(o => o !== p).flatMap(o => o.namespaces);
            for (const ns of p.namespaces) {
                if (claimed.includes(ns)) throw new Error(`Namespace collision: ${ns} is shipped by more than one plugin of this change`);
                for (const m of (ctx.state.procs.modules ?? []).filter(m => m.namespaces.includes(ns))) {
                    // A module's dir is its src (or the package itself when src is "."): inside this plugin = itself.
                    const owner = await fs.realpath(m.dir).catch(() => m.dir);
                    if (owner !== real && !owner.startsWith(real + '/')) throw new Error(`Namespace collision: ${ns} is provided by ${m.name}`);
                }
            }
        }
        // procs.requires: a plugin calls other plugins by name, so they must be there after the change.
        const provided = (n: string) => !!after[n] || (ctx.state.procs.modules ?? []).some(m => m.name === n || m.namespaces.includes(n));
        for (const p of [...(plugin ? [plugin] : []), ...added]) {
            const missing = p.requires.filter(n => !provided(n));
            if (missing.length) throw new Error(`${p.name} requires ${missing.join(', ')}: install ${missing.length === 1 ? 'it' : 'them'} first`);
        }
        if (!after[name]) {
            const dependents: string[] = [];
            for (const other of Object.keys(after)) {
                const req = await ctx.fns.plugins.inspectPackage({ dir: path.join(stage, 'node_modules', other) }).then(p => p.requires, () => [] as string[]);
                if (req.includes(name)) dependents.push(other);
            }
            if (dependents.length) throw new Error(`${name} is required by ${dependents.join(', ')}: remove ${dependents.length === 1 ? 'it' : 'them'} first`);
        }
        const old = before[name] && await exists(installedDir) ? await ctx.fns.plugins.inspectPackage({ dir: installedDir }).catch(() => undefined) : undefined;
        const changed: string[] = [];
        if (plugin && old)
            for (const f of plugin.files.filter(f => old.files.includes(f))) {
                const [a, b] = await Promise.all([fs.readFile(path.join(pluginDir, f)), fs.readFile(path.join(installedDir, f))]);
                if (!a.equals(b)) changed.push(f);
            }
        const lock = await fs.readFile(path.join(stage, 'bun.lock'), 'utf8').catch(() => '');
        const listPkgs = async (dir: string) => new Set((await fs.readdir(path.join(dir, 'node_modules')).catch(() => [] as string[])).filter(n => !n.startsWith('.')));
        const [had, has] = await Promise.all([listPkgs(host), listPkgs(stage)]);
        const result: types.plugins.HostChange = {
            operation, name,
            ...(after[name] ? { spec: after[name] } : {}),
            ...(lockLine(lock, name) ? { resolved: lockLine(lock, name) } : {}),
            ...(plugin ? { plugin } : {}),
            added: plugin ? plugin.files.filter(f => !old?.files.includes(f)) : [],
            removed: (old?.files ?? []).filter(f => !plugin?.files.includes(f)),
            changed,
            newPackages: [...has].filter(n => !had.has(n)).sort(),
            ...(added.length ? { companions: added.map(p => ({ name: p.name, spec: after[p.name]!, ...(p.version ? { version: p.version } : {}), namespaces: p.namespaces })) } : {}),
            ...(/Blocked \d+ postinstalls?/.test(log) ? { blockedScripts: log.match(/Blocked \d+ postinstalls?/)![0] } : {}),
            digest: createHash('sha256').update(JSON.stringify({ operation, name, spec: after[name] ?? null, lock, content: plugin?.digest ?? null, companions: added.map(p => p.digest), history: history ?? null })).digest('hex'),
            status: 'preview',
        };
        if (!opts.confirmed) return result;
        if (opts.expectedDigest !== result.digest) throw new Error('Preview digest mismatch: preview again');

        const back = path.join(host, '.history', String(Date.now()));
        if (operation !== 'rollback') {
            await fs.mkdir(back, { recursive: true });
            for (const f of STATE) if (await exists(path.join(host, f))) await fs.cp(path.join(host, f), path.join(back, f));
        }
        const previous = path.join(stage, '.previous-node_modules');
        if (await exists(path.join(host, 'node_modules'))) await fs.rename(path.join(host, 'node_modules'), previous);
        try {
            if (await exists(path.join(stage, 'node_modules'))) await fs.rename(path.join(stage, 'node_modules'), path.join(host, 'node_modules'));
            for (const f of STATE) {
                if (await exists(path.join(stage, f))) await fs.cp(path.join(stage, f), path.join(host, f));
                else await fs.rm(path.join(host, f), { force: true });
            }
        } catch (cause) {
            await fs.rm(path.join(host, 'node_modules'), { recursive: true, force: true });
            if (await exists(previous)) await fs.rename(previous, path.join(host, 'node_modules'));
            if (operation !== 'rollback') for (const f of STATE) if (await exists(path.join(back, f))) await fs.cp(path.join(back, f), path.join(host, f));
            throw new Error('Could not switch the plugin host; previous state restored', { cause });
        }
        // The rollback entry is consumed: the next rollback goes one step further back.
        if (operation === 'rollback') await fs.rm(path.join(host, '.history', history!), { recursive: true, force: true });
        try {
            // A reload only (re)registers what is mounted; what an uninstalled plugin registered would stay callable
            // until a restart. Drop its namespaces and fences first (routes are rebuilt from the scan by the reload).
            if (old && !after[name]) {
                let root: any = ctx;
                while (Object.getPrototypeOf(root) !== Object.prototype) root = Object.getPrototypeOf(root);
                for (const ns of old.namespaces) {
                    if ((root.state.procs.modules ?? []).some((m: any) => m.name !== name && m.namespaces?.includes(ns))) continue;
                    delete root.state.registry?.[ns];
                    for (const [lang, fence] of Object.entries(root.state.markdown?.fences ?? {}) as Array<[string, any]>)
                        if (fence?.module === ns) delete root.state.markdown.fences[lang];
                }
            }
            await ctx.fns.procs.modules.reload({});
            return { ...result, status: 'applied' };
        } catch (cause) {
            return { ...result, status: 'applied-load-failed', loadError: 'Plugin files are in place but remounting failed; runtime may be partial. ' + (cause instanceof Error ? cause.message.slice(0, 300) : '') };
        }
    } finally {
        await fs.rm(stage, { recursive: true, force: true });
        await fs.rm(lockDir, { recursive: true, force: true });
    }
}
