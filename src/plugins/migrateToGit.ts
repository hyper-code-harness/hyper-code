/**
 * Moves plugins installed as bun packages in the old PLUGIN_HOST folder to git clones in USER_PLUGINS, same release each
 *
 * Use once per machine to leave the bun-installed plugin host. For every dependency of <host>/package.json with a
 * `github:owner/repo#vX.Y.Z` (or `git+file://…#vX.Y.Z`) spec it previews plugins.gitInstall of that tag; with
 * confirmed:true it clones each into USER_PLUGINS/<name>, records it in the plugin lock, removes the dependency from
 * the host package.json in the same step (a plugin in both places would be a boot collision), remounts plugins once
 * and checks that every namespace is now served from USER_PLUGINS. The host's package.json and bun.lock are first
 * copied to <host>/.history/<time>-migrate. Dependencies already cloned, or with a spec that is not a release tag,
 * are skipped and reported. The USER_PLUGINS clone watcher is paused while it runs.
 * @param opts.host Plugin host folder; defaults to PLUGIN_HOST, else ~/.hyper/plugins.
 * @param opts.confirmed Clone and switch; without it only previews. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin host folder; defaults to PLUGIN_HOST, else ~/.hyper/plugins. */
    host?: string;
    /** Clone and switch; without it only previews. @default false */
    confirmed?: boolean;
}): Promise<{
    host: string;
    backup?: string;
    plugins: Array<{ name: string; spec: string; repo?: string; tag?: string; commit?: string; namespaces?: string[]; status: 'preview' | 'migrated' | 'skipped' | 'failed'; reason?: string }>;
    verified: boolean;
    remaining: Record<string, string>;
}> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const home = String(ctx.env.HOME || os.homedir());
    const host = path.resolve(String(opts.host || ctx.env.PLUGIN_HOST || '~/.hyper/plugins').trim().replace(/^~(?=\/)/, home));
    const mountCfg = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!mountCfg) throw new Error('USER_PLUGINS is not configured');
    const mount = path.resolve(mountCfg.replace(/^~(?=\/)/, home));
    const pkgFile = path.join(host, 'package.json');
    const readPkg = async () => JSON.parse(await fs.readFile(pkgFile, 'utf8').catch(() => '{}'));
    const deps: Record<string, string> = (await readPkg()).dependencies ?? {};
    type Row = { name: string; spec: string; repo?: string; tag?: string; commit?: string; namespaces?: string[]; status: 'preview' | 'migrated' | 'skipped' | 'failed'; reason?: string };
    const out: Row[] = [];
    const plan: Array<{ name: string; spec: string; repo: string; tag: string }> = [];
    for (const [name, spec] of Object.entries(deps)) {
        const m = /^(github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+|git\+file:\/\/\/\S+?)#(v\d+\.\d+\.\d+)$/.exec(spec);
        if (!m) { out.push({ name, spec, status: 'skipped', reason: 'spec is not a repository at a vX.Y.Z tag' }); continue; }
        if (await fs.lstat(path.join(mount, name)).then(() => true, () => false)) { out.push({ name, spec, status: 'skipped', reason: `${path.join(mount, name)} already exists` }); continue; }
        plan.push({ name, spec, repo: m[1]!, tag: m[2]! });
    }
    // The clone watcher would remount as soon as a clone lands, while the host still lists it: pause it.
    const watching = opts.confirmed && plan.length ? (await ctx.fns.plugins.watchClones({ stop: true }), true) : false;
    try {
    let backup: string | undefined;
    if (opts.confirmed && plan.length) {
        backup = path.join(host, '.history', `${Date.now()}-migrate`);
        await fs.mkdir(backup, { recursive: true });
        for (const f of ['package.json', 'bun.lock']) await fs.cp(path.join(host, f), path.join(backup, f)).catch(() => {});
    }
    for (const p of plan) {
        const base = { operation: 'install' as const, name: p.name, repo: p.repo, tag: p.tag, replaces: path.join(host, 'node_modules', p.name), reload: false };
        try {
            const preview = await ctx.fns.plugins.gitInstall(base);
            if (!opts.confirmed) {
                out.push({ name: p.name, spec: p.spec, repo: p.repo, tag: p.tag, commit: preview.commit!, namespaces: preview.plugin?.namespaces ?? [], status: 'preview' });
                continue;
            }
            const applied = await ctx.fns.plugins.gitInstall({ ...base, confirmed: true, expectedDigest: preview.digest });
            // Same step: the host must stop declaring it before the next mount, or both copies load.
            const pkg = await readPkg();
            delete pkg.dependencies?.[p.name];
            await fs.writeFile(pkgFile, JSON.stringify(pkg, null, 2) + '\n');
            out.push({ name: p.name, spec: p.spec, repo: p.repo, tag: p.tag, commit: applied.commit!, namespaces: applied.plugin?.namespaces ?? [], status: 'migrated' });
        } catch (e) {
            out.push({ name: p.name, spec: p.spec, repo: p.repo, tag: p.tag, status: 'failed', reason: e instanceof Error ? e.message.slice(0, 400) : 'failed' });
        }
    }
    let verified = !opts.confirmed;
    if (opts.confirmed && out.some(p => p.status === 'migrated')) {
        // What the removed host copies registered is replaced by the clones' registration in the reload.
        await ctx.fns.procs.modules.reload({});
        const real = await fs.realpath(mount).catch(() => mount);
        verified = true;
        for (const p of out.filter(p => p.status === 'migrated')) {
            const m = (ctx.state.procs.modules ?? []).find(m => m.name === p.name);
            const dir = m ? await fs.realpath(m.dir).catch(() => m.dir) : '';
            const ok = !!m && dir.startsWith(real + '/') && (p.namespaces ?? []).every(ns => m.namespaces.includes(ns));
            if (!ok) { verified = false; p.reason = `not mounted from ${mount} after reload`; }
        }
    }
    return { host, ...(backup ? { backup } : {}), plugins: out, verified, remaining: (await readPkg()).dependencies ?? {} };
    } finally {
        if (watching) await ctx.fns.plugins.watchClones({});
    }
}
