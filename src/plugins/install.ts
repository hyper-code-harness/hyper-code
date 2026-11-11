/**
 * Installs or updates a plugin from the listing by name, together with the plugins it requires
 *
 * Use when an agent or the UI wants a listed plugin: give its name (and optionally a version), get a preview of the
 * git clone plugins.gitInstall will put in USER_PLUGINS — the plugin, every plugin it needs through procs.requires
 * that is not mounted yet (resolved from the listing, transitively: the newest release, or the newest one inside
 * the range when procs.requires gives `{ name: range }`), commit, files, packages, the npm install scripts that
 * confirming would run (`installScripts`) and conflicts. Nothing changes until the same call is repeated with confirmed:true and the preview's digest. An
 * installed clone is updated to the requested or newest release (refused while it has local work). Plugins it needs
 * that are not in the listing make the preview fail with their names. Dev mode: `branch` installs (or switches an
 * installed clone) onto a branch it then follows, `commit` pins it to an exact commit; give at most one of version,
 * branch and commit. Without any of them an installed clone keeps its mode: a branch clone previews the fast-forward
 * to the new branch head, a commit clone has nothing to update, a tag clone goes to the newest release.
 * A required plugin that is already installed is not moved: when its version is outside the range the preview
 * fails and says to update it first. npm dependencies install exactly from the bun.lock committed in the repository.
 * @param opts.name Plugin name from plugins.catalog.
 * @param opts.version Release to install, e.g. 1.2.0; defaults to the newest vX.Y.Z tag.
 * @param opts.branch Branch to install on, or switch an installed clone to, and follow (dev mode).
 * @param opts.commit Exact commit (7–40 hex) to install at or switch an installed clone to.
 * @param opts.confirmed Apply the previewed change. @default false
 * @param opts.expectedDigest Digest of the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name from plugins.catalog. */
    name: string;
    /** Release to install, e.g. 1.2.0; defaults to the newest vX.Y.Z tag. */
    version?: string;
    /** Branch to install on, or switch an installed clone to, and follow (dev mode). */
    branch?: string;
    /** Exact commit (7–40 hex) to install at or switch an installed clone to. */
    commit?: string;
    /** Apply the previewed change. @default false */
    confirmed?: boolean;
    /** Digest of the preview being confirmed. */
    expectedDigest?: string;
}): Promise<types.plugins.GitChange> {
    const { plugins } = await ctx.fns.plugins.listing({});
    const release = async (name: string, version?: string) => {
        const entry = plugins.find(p => p.name === name);
        if (!entry) throw new Error(`${name} is not in the plugin listing`);
        const tags = await ctx.fns.plugins.versions({ source: entry.source });
        const tag = version ? tags.find(t => t.version === version.replace(/^v/, '')) : tags[0];
        if (!tag) throw new Error(version ? `${name} has no release ${version}` : `${name} has no vX.Y.Z release`);
        return { entry, tag };
    };
    if ([opts.version, opts.branch, opts.commit].filter(v => v !== undefined && v !== '').length > 1) throw new Error('Give one of version, branch or commit');
    const { lock } = await ctx.fns.plugins.lockFile({});
    const current = lock.plugins[opts.name];
    const entry = plugins.find(p => p.name === opts.name);
    if (!entry) throw new Error(`${opts.name} is not in the plugin listing`);
    // The ref to go to: a release tag (given, or newest), a branch or a commit. An installed clone without a ref
    // keeps its mode: branch → follow it, commit → gitInstall says there is nothing to update.
    const noRef = !opts.version && !opts.branch && !opts.commit;
    const branch = opts.branch || (noRef && current?.branch ? current.branch : undefined);
    const keep = noRef && !!current && !current.tag && !current.branch;
    const main = branch || opts.commit || keep ? { entry, tag: null } : await release(opts.name, opts.version);

    // procs.requires of the release, read from its package.json at that tag, without installing anything.
    // `ref` is a tag, branch or commit: GitHub's raw files and `git show` take each of them.
    const requiresOf = async (source: string, ref: string): Promise<Array<[string, string]>> => {
        let pkg: any = null;
        if (source.startsWith('github:')) {
            const res = await fetch(`https://raw.githubusercontent.com/${source.slice(7)}/${ref}/package.json`, { signal: AbortSignal.timeout(15000) });
            if (res.ok) pkg = await res.json();
        } else {
            const p = Bun.spawnSync(['git', 'show', `${ref}:package.json`], { cwd: new URL(source.slice(4)).pathname });
            if (!p.exitCode) pkg = JSON.parse(p.stdout.toString());
        }
        if (!pkg) throw new Error(`Could not read package.json of ${source}#${ref}`);
        // ["demo"] — any version; { "demo": "^1.2" } — a semver range (plugins.inspectPackage checks the grammar on the clone).
        const r = pkg.procs?.requires;
        if (Array.isArray(r)) return r.map((n: unknown) => [String(n), '*']);
        return r && typeof r === 'object' ? Object.entries(r).map(([n, v]) => [n, String(v).trim()]) : [];
    };
    const mounted = (n: string) => !!lock.plugins[n] || (ctx.state.procs.modules ?? []).some(m => m.name === n || m.namespaces.includes(n));
    const companions: Record<string, { repo: string; tag: string }> = {};
    // For a branch or a commit the requires are best-effort here (a short SHA may not resolve remotely); gitInstall checks them again on the clone.
    const queue = keep ? [] : main.tag ? await requiresOf(main.entry.source, main.tag.commit)
        : await requiresOf(main.entry.source, (branch || opts.commit)!).catch(() => [] as Array<[string, string]>);
    // A missing plugin is cloned at its newest release inside every range asked of it. One already installed is
    // left as it is: gitInstall refuses the change when its version is outside the range.
    const wanted: Record<string, string[]> = {};
    while (queue.length) {
        const [need, range] = queue.shift()!;
        if (need === opts.name || mounted(need)) continue;
        const ranges = wanted[need] ??= [];
        if (companions[need] && (ranges.includes(range) || Bun.semver.satisfies(companions[need]!.tag.slice(1), range))) { ranges.push(range); continue; }
        ranges.push(range);
        const dep = plugins.find(p => p.name === need);
        if (!dep) throw new Error(`${opts.name} requires ${need}, which is neither installed nor in the listing`);
        const tags = await ctx.fns.plugins.versions({ source: dep.source });
        const tag = tags.find(t => ranges.every(r => r === '*' || Bun.semver.satisfies(t.version, r)));
        if (!tag) throw new Error(`${opts.name} requires ${need} ${ranges.filter(r => r !== '*').join(' and ') || '(any release)'}, but ${need} has ${tags.length ? 'only ' + tags.slice(0, 5).map(t => t.version).join(', ') : 'no vX.Y.Z release'}`);
        companions[need] = { repo: dep.source, tag: tag.tag };
        queue.push(...await requiresOf(dep.source, tag.commit));
    }
    return await ctx.fns.plugins.gitInstall({
        operation: current ? 'update' : 'install',
        name: opts.name,
        repo: main.entry.source,
        ...(main.tag ? { tag: main.tag.tag, commit: main.tag.commit } : branch ? { branch } : opts.commit ? { commit: opts.commit } : {}),
        ...(Object.keys(companions).length ? { with: companions } : {}),
        ...(opts.confirmed ? { confirmed: true, expectedDigest: opts.expectedDigest ?? '' } : {}),
    });
}
