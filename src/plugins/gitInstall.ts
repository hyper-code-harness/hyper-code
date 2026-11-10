/**
 * Installs, updates, rolls back or removes a plugin as a git clone in USER_PLUGINS, after a preview bound by a commit digest
 *
 * Use for plugins distributed as git repositories with vX.Y.Z release tags. The first call is a preview and leaves
 * USER_PLUGINS untouched: install clones the tag into a staging folder beside USER_PLUGINS, runs `bun install
 * --ignore-scripts` there, checks the tree with plugins.inspectPackage, checks its namespaces against every other
 * mounted module and its procs.requires against what is mounted or cloned in the same step (opts.with), and returns
 * the files, new npm packages and a digest of operation, repo, commit SHA, tree SHA and content. Update fetches the
 * repository's tags into the clone and previews the new tag with a diff against the current commit; rollback does
 * the same for the last `previous` entry of the lock. Both refuse while the clone has uncommitted or unpushed work
 * and list it. Remove previews what goes away, refuses while another installed plugin requires it, and needs
 * force:true when the clone has local work. Repeating the call with confirmed:true and the digest applies it: moves
 * the staged clone into USER_PLUGINS/<name> (or checks the new commit out in place), records repo, tag, commit and
 * history in the lock file (plugins.lockFile) and remounts plugins with procs.modules.reload.
 * @param opts.operation install, update, rollback or remove.
 * @param opts.name Plugin name: the folder under USER_PLUGINS and the package.json name.
 * @param opts.repo Repository for install (`github:owner/repo`, `git+file:///…` or a git URL); update defaults to the lock's.
 * @param opts.tag Release tag (vX.Y.Z) for install and update.
 * @param opts.commit Expected commit SHA of the tag; the preview fails when the tag points elsewhere.
 * @param opts.with Other plugins to clone in the same step, name → { repo, tag }: the plugins this one requires (plugins.install fills it).
 * @param opts.replaces Absolute folder of an older copy of the same plugin this clone replaces (plugins.migrateToGit): modules mounted from it are not a namespace collision.
 * @param opts.reload Remount plugins after applying; plugins.migrateToGit remounts once at the end. @default true
 * @param opts.force Remove a clone even though it has uncommitted or unpushed work. @default false
 * @param opts.confirmed Apply the previewed change. @default false
 * @param opts.expectedDigest Digest returned by the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** install, update, rollback or remove. */
    operation: 'install' | 'update' | 'rollback' | 'remove';
    /** Plugin name: the folder under USER_PLUGINS and the package.json name. */
    name: string;
    /** Repository for install (`github:owner/repo`, `git+file:///…` or a git URL); update defaults to the lock's. */
    repo?: string;
    /** Release tag (vX.Y.Z) for install and update. */
    tag?: string;
    /** Expected commit SHA of the tag; the preview fails when the tag points elsewhere. */
    commit?: string;
    /** Other plugins to clone in the same step, name → { repo, tag }: the plugins this one requires. */
    with?: Record<string, { repo: string; tag: string }>;
    /** Absolute folder of an older copy of the same plugin this clone replaces: modules mounted from it are not a namespace collision. */
    replaces?: string;
    /** Remount plugins after applying; plugins.migrateToGit remounts once at the end. @default true */
    reload?: boolean;
    /** Remove a clone even though it has uncommitted or unpushed work. @default false */
    force?: boolean;
    /** Apply the previewed change. @default false */
    confirmed?: boolean;
    /** Digest returned by the preview being confirmed. */
    expectedDigest?: string;
}): Promise<types.plugins.GitChange> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { createHash } = await import('node:crypto');
    const NAME = /^[a-z][a-z0-9-]{0,63}$/, TAG = /^v\d+\.\d+\.\d+$/;
    const { operation, name } = opts;
    if (!['install', 'update', 'rollback', 'remove'].includes(operation)) throw new Error('Unsupported operation');
    if (!NAME.test(String(name ?? ''))) throw new Error('Invalid plugin name');
    if (opts.tag !== undefined && !TAG.test(opts.tag)) throw new Error('Release tag must be vX.Y.Z');
    const extra = Object.entries(opts.with ?? {});
    if (extra.length && operation !== 'install' && operation !== 'update') throw new Error('with is only for install and update');
    for (const [n, w] of extra)
        if (!NAME.test(n) || n === name || !w || typeof w.repo !== 'string' || !TAG.test(String(w.tag))) throw new Error('Invalid with entry: ' + n);
    const configured = String(ctx.env.USER_PLUGINS ?? '').trim();
    if (!configured) throw new Error('USER_PLUGINS is not configured');
    const mount = path.resolve(configured.replace(/^~(?=\/)/, String(ctx.env.HOME || os.homedir())));
    const exists = (p: string) => fs.lstat(p).then(() => true, () => false);
    const gitUrl = (repo: string) => {
        if (/^github:[A-Za-z0-9-]+\/[A-Za-z0-9._-]+$/.test(repo)) return `https://github.com/${repo.slice(7)}.git`;
        if (/^git\+(file|https):\/\/\S+$/.test(repo)) return repo.slice(4);
        if (/^(https|file):\/\/\S+$/.test(repo) || (path.isAbsolute(repo) && !/\s/.test(repo))) return repo;
        throw new Error('Unsupported plugin repository: ' + repo);
    };
    const git = async (cwd: string, args: string[], allowFail = false) => {
        const p = Bun.spawn(['git', '-c', 'advice.detachedHead=false', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } });
        const timer = setTimeout(() => p.kill(), 120_000);
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        clearTimeout(timer);
        if (code && !allowFail) throw new Error(`git ${args[0]} failed: ${(err.trim().split('\n').at(-1) ?? String(code)).slice(0, 300)}`);
        return code ? '' : out.trim();
    };
    const npmInstall = async (cwd: string) => {
        const pkg = JSON.parse(await fs.readFile(path.join(cwd, 'package.json'), 'utf8').catch(() => '{}'));
        if (!Object.keys({ ...pkg.dependencies, ...pkg.optionalDependencies }).length) return '';
        const p = Bun.spawn([process.execPath, 'install', '--ignore-scripts', '--production', '--no-save'], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, BUN_BE_BUN: '1' } });
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        if (code) throw new Error(`bun install failed: ${(err.trim().split('\n').at(-1) ?? '').slice(0, 300)}`);
        return out + err;
    };
    // node_modules is the installer's (bun runs with --no-save, so no bun.lock appears), not the plugin author's: keep them out of `git status`.
    const exclude = async (dir: string) => {
        const file = path.join(dir, '.git', 'info', 'exclude');
        const text = await fs.readFile(file, 'utf8').catch(() => '');
        if (!text.includes('/node_modules/')) {
            await fs.mkdir(path.dirname(file), { recursive: true });
            await fs.writeFile(file, text + (text && !text.endsWith('\n') ? '\n' : '') + '/node_modules/\n');
        }
    };
    const tagCommit = async (dir: string, tag: string) => {
        const sha = await git(dir, ['rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`], true);
        if (!/^[0-9a-f]{40}$/.test(sha)) throw new Error(`No release ${tag}`);
        return sha;
    };
    const listPkgs = async (dir: string) => {
        const top = await fs.readdir(path.join(dir, 'node_modules')).catch(() => [] as string[]);
        const out: string[] = [];
        for (const n of top.filter(n => !n.startsWith('.')))
            if (n.startsWith('@')) for (const s of await fs.readdir(path.join(dir, 'node_modules', n)).catch(() => [] as string[])) out.push(`${n}/${s}`);
            else out.push(n);
        return new Set(out);
    };
    const diffFiles = async (oldDir: string | null, now: types.plugins.PackageInspection | undefined, nowDir: string, old?: types.plugins.PackageInspection) => {
        const changed: string[] = [];
        if (now && old && oldDir)
            for (const f of now.files.filter(f => old.files.includes(f))) {
                const [a, b] = await Promise.all([fs.readFile(path.join(nowDir, f)), fs.readFile(path.join(oldDir, f))]);
                if (!a.equals(b)) changed.push(f);
            }
        return {
            added: now ? now.files.filter(f => !old?.files.includes(f)) : [],
            removed: (old?.files ?? []).filter(f => !now?.files.includes(f)),
            changed,
        };
    };
    const modules = () => ctx.state.procs.modules ?? [];
    const dirOf = (n: string) => path.join(mount, n);

    await fs.mkdir(mount, { recursive: true });
    const base = path.dirname(mount);
    const opLock = path.join(base, '.plugin-operation-lock');
    await fs.mkdir(opLock).catch(() => { throw new Error('Another plugin operation is running'); });
    await fs.mkdir(path.join(base, '.plugin-staging'), { recursive: true });
    const stage = await fs.mkdtemp(path.join(base, '.plugin-staging', `${name}-`));
    try {
        const { lock } = await ctx.fns.plugins.lockFile({});
        const target = dirOf(name);
        const installed = await exists(target);
        const entry = lock.plugins[name];

        // ── remove ────────────────────────────────────────────────────────────
        if (operation === 'remove') {
            if (!installed) throw new Error('Plugin is not installed: ' + name);
            if (!entry) throw new Error(`${name} was not installed as a git clone; remove its folder by hand`);
            const dependents: string[] = [];
            for (const other of (await fs.readdir(mount)).filter(n => n !== name && !n.startsWith('.'))) {
                const pkg = JSON.parse(await fs.readFile(path.join(mount, other, 'package.json'), 'utf8').catch(() => '{}'));
                if (Array.isArray(pkg?.procs?.requires) && pkg.procs.requires.includes(name)) dependents.push(other);
            }
            if (dependents.length) throw new Error(`${name} is required by ${dependents.join(', ')}: remove ${dependents.length === 1 ? 'it' : 'them'} first`);
            const old = await ctx.fns.plugins.inspectPackage({ dir: target }).catch(() => undefined);
            const st = await ctx.fns.plugins.cloneStatus({ dir: target });
            const needsForce = st.dirty.length > 0 || st.unpushed.length > 0;
            const result: types.plugins.GitChange = {
                operation, name, repo: entry.repo,
                ...(st.commit ? { from: { commit: st.commit, ...(st.tag ? { tag: st.tag } : {}) } } : {}),
                added: [], removed: old?.files ?? [], changed: [], newPackages: [],
                dirty: st.dirty, unpushed: st.unpushed, needsForce,
                digest: createHash('sha256').update(JSON.stringify({ operation, name, commit: st.commit ?? null, content: old?.digest ?? null, dirty: st.dirty, unpushed: st.unpushed })).digest('hex'),
                status: 'preview',
            };
            if (!opts.confirmed) return result;
            if (opts.expectedDigest !== result.digest) throw new Error('Preview digest mismatch: preview again');
            if (needsForce && opts.force !== true)
                throw new Error(`${name} has local work (${st.dirty.length} uncommitted, ${st.unpushed.length} unpushed): push it, or confirm with force:true to delete it`);
            await fs.rename(target, path.join(stage, 'removed'));
            delete lock.plugins[name];
            await ctx.fns.plugins.lockFile({ lock });
            try {
                // A reload only (re)registers what is mounted; what the removed plugin registered would stay callable
                // until a restart. Drop its namespaces and fences first (routes are rebuilt from the scan).
                let root: any = ctx;
                while (Object.getPrototypeOf(root) !== Object.prototype) root = Object.getPrototypeOf(root);
                for (const ns of old?.namespaces ?? []) {
                    if ((root.state.procs?.modules ?? []).some((m: any) => m.name !== name && m.namespaces?.includes(ns))) continue;
                    delete root.state.registry?.[ns];
                    for (const [lang, fence] of Object.entries(root.state.markdown?.fences ?? {}) as Array<[string, any]>)
                        if (fence?.module === ns) delete root.state.markdown.fences[lang];
                }
                await ctx.fns.procs.modules.reload({});
                return { ...result, status: 'applied' };
            } catch (cause) {
                return { ...result, status: 'applied-load-failed', loadError: 'Plugin removed but remounting failed. ' + (cause instanceof Error ? cause.message.slice(0, 300) : '') };
            }
        }

        // ── install / update / rollback: stage the new commit ─────────────────
        if (operation === 'install' && installed) throw new Error(`${name} is already installed: use update`);
        if (operation !== 'install' && !installed) throw new Error('Plugin is not installed: ' + name);
        if (operation !== 'install' && !entry) throw new Error(`${name} was not installed as a git clone`);
        let from: { tag?: string; commit: string } | undefined;
        let repo: string, tag: string, commit: string;
        const staged = path.join(stage, name);
        if (operation === 'install') {
            if (!opts.repo || !opts.tag) throw new Error('install needs repo and tag');
            repo = opts.repo; tag = opts.tag;
            await git(stage, ['clone', '-q', '--no-checkout', gitUrl(repo), staged]);
            commit = await tagCommit(staged, tag);
        } else {
            const st = await ctx.fns.plugins.cloneStatus({ dir: target });
            if (!st.git || !st.commit) throw new Error(`${name} is not a git clone`);
            if (st.dirty.length || st.unpushed.length)
                throw new Error(`${name} has local work — commit and push, or discard it first. Uncommitted: ${st.dirty.join(', ') || 'none'}. Unpushed: ${st.unpushed.join('; ') || 'none'}`);
            from = { commit: st.commit, ...(st.tag ? { tag: st.tag } : {}) };
            repo = opts.repo ?? entry!.repo;
            if (operation === 'update') {
                if (!opts.tag) throw new Error('update needs a tag');
                tag = opts.tag;
                await git(target, ['fetch', '-q', gitUrl(repo), 'refs/tags/*:refs/tags/*']);
                commit = await tagCommit(target, tag);
            } else {
                const prev = entry!.previous.at(-1);
                if (!prev) throw new Error('Nothing to roll back to');
                tag = prev.tag; commit = prev.commit;
                if (!await git(target, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`], true))
                    throw new Error(`Commit ${commit.slice(0, 12)} of ${tag} is not in the clone`);
            }
            await git(stage, ['clone', '-q', '--no-checkout', target, staged]);
        }
        if (opts.commit && opts.commit !== commit) throw new Error(`${tag} points at ${commit.slice(0, 12)}, not ${opts.commit.slice(0, 12)}`);
        await git(staged, ['checkout', '-q', '--detach', commit]);
        const tree = await git(staged, ['rev-parse', `${commit}^{tree}`]);
        await exclude(staged);
        let log = await npmInstall(staged);
        const plugin = await ctx.fns.plugins.inspectPackage({ dir: staged });
        if (plugin.name !== name) throw new Error(`Package is ${plugin.name}, not ${name}`);

        const companions: Array<{ name: string; repo: string; tag: string; commit: string; tree: string; plugin: types.plugins.PackageInspection; dir: string }> = [];
        for (const [n, w] of extra) {
            if (await exists(dirOf(n))) throw new Error(`${n} is already installed`);
            const dir = path.join(stage, n);
            await git(stage, ['clone', '-q', '--no-checkout', gitUrl(w.repo), dir]);
            const c = await tagCommit(dir, w.tag);
            await git(dir, ['checkout', '-q', '--detach', c]);
            await exclude(dir);
            log += await npmInstall(dir);
            const p = await ctx.fns.plugins.inspectPackage({ dir });
            if (p.name !== n) throw new Error(`Package is ${p.name}, not ${n}`);
            companions.push({ name: n, repo: w.repo, tag: w.tag, commit: c, tree: await git(dir, ['rev-parse', `${c}^{tree}`]), plugin: p, dir });
        }

        // Namespaces are global: one owned by any other mounted module stays theirs — no silent override.
        const all = [{ name, plugin }, ...companions.map(c => ({ name: c.name, plugin: c.plugin }))];
        const replaced = opts.replaces ? await fs.realpath(opts.replaces).catch(() => opts.replaces!) : null;
        for (const p of all) {
            const own = await fs.realpath(dirOf(p.name)).catch(() => dirOf(p.name));
            const claimed = all.filter(o => o !== p).flatMap(o => o.plugin.namespaces);
            for (const ns of p.plugin.namespaces) {
                if (claimed.includes(ns)) throw new Error(`Namespace collision: ${ns} is shipped by more than one plugin of this change`);
                for (const m of modules().filter(m => m.namespaces.includes(ns))) {
                    const owner = await fs.realpath(m.dir).catch(() => m.dir);
                    if (replaced && p.name === name && (owner === replaced || owner.startsWith(replaced + '/'))) continue;
                    if (owner !== own && !owner.startsWith(own + '/')) throw new Error(`Namespace collision: ${ns} is provided by ${m.name}`);
                }
            }
        }
        const provided = (n: string) => all.some(p => p.name === n) || modules().some(m => m.name === n || m.namespaces.includes(n));
        for (const p of all) {
            const missing = p.plugin.requires.filter(n => !provided(n));
            if (missing.length) throw new Error(`${p.name} requires ${missing.join(', ')}: install ${missing.length === 1 ? 'it' : 'them'} first`);
        }

        const old = installed ? await ctx.fns.plugins.inspectPackage({ dir: target }).catch(() => undefined) : undefined;
        const files = await diffFiles(installed ? target : null, plugin, staged, old);
        const diffStat = from ? await git(target, ['diff', '--stat', from.commit, commit], true) : '';
        const had = installed ? await listPkgs(target) : new Set<string>();
        const has = await listPkgs(staged);
        for (const c of companions) for (const p of await listPkgs(c.dir)) has.add(p);
        const result: types.plugins.GitChange = {
            operation, name, repo, tag, commit, tree,
            ...(from ? { from } : {}),
            plugin, ...files,
            ...(diffStat ? { diffStat: diffStat.slice(0, 4000) } : {}),
            ...(companions.length ? { companions: companions.map(c => ({ name: c.name, repo: c.repo, tag: c.tag, commit: c.commit, ...(c.plugin.version ? { version: c.plugin.version } : {}), namespaces: c.plugin.namespaces })) } : {}),
            newPackages: [...has].filter(n => !had.has(n)).sort(),
            ...(/Blocked \d+ postinstalls?/.test(log) ? { blockedScripts: log.match(/Blocked \d+ postinstalls?/)![0] } : {}),
            digest: createHash('sha256').update(JSON.stringify({
                operation, name, repo, tag, commit, tree, content: plugin.digest, from: from?.commit ?? null,
                companions: companions.map(c => [c.name, c.repo, c.tag, c.commit, c.tree, c.plugin.digest]),
            })).digest('hex'),
            status: 'preview',
        };
        if (!opts.confirmed) return result;
        if (opts.expectedDigest !== result.digest) throw new Error('Preview digest mismatch: preview again');

        // ── apply ─────────────────────────────────────────────────────────────
        if (operation === 'install') {
            const moved: string[] = [];
            try {
                for (const c of [{ name, dir: staged }, ...companions]) {
                    await fs.rename(c.dir, dirOf(c.name));
                    moved.push(c.name);
                }
            } catch (cause) {
                for (const n of moved) await fs.rm(dirOf(n), { recursive: true, force: true });
                throw new Error('Could not move the clone into USER_PLUGINS; nothing installed', { cause });
            }
            lock.plugins[name] = { repo, tag, commit, previous: [] };
        } else {
            // In place: the clone keeps its remotes, branches and reflog. node_modules comes from the staged copy.
            await git(target, ['checkout', '-q', '--detach', commit]);
            await fs.rm(path.join(target, 'node_modules'), { recursive: true, force: true });
            if (await exists(path.join(staged, 'node_modules'))) await fs.rename(path.join(staged, 'node_modules'), path.join(target, 'node_modules'));
            for (const c of companions) await fs.rename(c.dir, dirOf(c.name));
            const previous = [...entry!.previous];
            if (operation === 'rollback') previous.pop();
            else previous.push({ tag: entry!.tag, commit: entry!.commit });
            lock.plugins[name] = { repo, tag, commit, previous: previous.slice(-20) };
        }
        for (const c of companions) lock.plugins[c.name] = { repo: c.repo, tag: c.tag, commit: c.commit, previous: [] };
        await ctx.fns.plugins.lockFile({ lock });
        if (opts.reload === false) return { ...result, status: 'applied' };
        try {
            await ctx.fns.procs.modules.reload({});
            return { ...result, status: 'applied' };
        } catch (cause) {
            return { ...result, status: 'applied-load-failed', loadError: 'Plugin files are in place but remounting failed; runtime may be partial. ' + (cause instanceof Error ? cause.message.slice(0, 300) : '') };
        }
    } finally {
        await fs.rm(stage, { recursive: true, force: true });
        await fs.rm(opLock, { recursive: true, force: true });
    }
}
