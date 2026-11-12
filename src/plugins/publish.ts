/**
 * Publishes a local plugin for the first time: pushes it to an empty git repository on any server, tags the first release and can add it to a plugin listing — after a preview bound by a digest
 *
 * Use once per plugin, after plugins.create or plugins.gitInit, to take it from this machine to a repository others can install from; later versions go through plugins.release. The first call is a preview and changes nothing: it runs plugins.releaseCheck (the package checks of an install, bun.lock, the plugin's tests), checks that the target repository is reachable and empty, that the catalog does not already give this name to another repository, and returns the version and tag, what package.json gets (version, repository), the files, the listing entry and a digest. Repeating with confirmed:true and that digest applies it: commits the package.json change, tags vX.Y.Z, adds `origin`, pushes the branch and the tag, records the plugin in the lock and leaves the clone at the released tag, like an install. Works with any git server (plugins.repoUrl) using the git access this machine has; only for GitHub can the repository be created for you (createRepo, private unless visibility says public) — elsewhere create an empty repository first. With `listing` (the address of a listing repository: plugins/<name>.json files and index.json) the entry is committed and pushed there too; without push rights the plugin is still published and the result says to open a pull request with `entry`. If the push of the plugin fails, the tag, the remote and the release commit are undone and nothing is published. Refuses a clone that already has an origin, uncommitted changes, a detached HEAD and a non-empty target. Publishing is outward-facing: confirm with the person first.
 * @param opts.name Plugin name: a git repository without a remote in USER_PLUGINS (plugins.create or plugins.gitInit made it).
 * @param opts.repo Where it is published: an empty repository on a git server (GitHub or another) — github:owner/repo, https://host/path, ssh://git@host/path, git@host:path.
 * @param opts.version First released version, X.Y.Z; defaults to the package.json version.
 * @param opts.createRepo Create the repository when it does not exist. GitHub only (gh). @default false
 * @param opts.visibility Visibility of a repository created by createRepo. @default private
 * @param opts.listing Address of a listing repository to add the plugin to (plugins/<name>.json and index.json), e.g. github:hyper-code-harness/plugins.
 * @param opts.keepBranch Stay on the branch afterwards instead of moving the clone to the released tag. @default false
 * @param opts.confirmed Apply the previewed publication. @default false
 * @param opts.expectedDigest Digest returned by the preview being confirmed.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Plugin name: a git repository without a remote in USER_PLUGINS (plugins.create or plugins.gitInit made it). */
        name: string;
        /** Where it is published: an empty repository on a git server (GitHub or another) — github:owner/repo, https://host/path, ssh://git@host/path, git@host:path. */
        repo: string;
        /** First released version, X.Y.Z; defaults to the package.json version. */
        version?: string;
        /** Create the repository when it does not exist. GitHub only (gh). @default false */
        createRepo?: boolean;
        /** Visibility of a repository created by createRepo. @default private */
        visibility?: 'public' | 'private';
        /** Address of a listing repository to add the plugin to (plugins/<name>.json and index.json), e.g. github:hyper-code-harness/plugins. */
        listing?: string;
        /** Stay on the branch afterwards instead of moving the clone to the released tag. @default false */
        keepBranch?: boolean;
        /** Apply the previewed publication. @default false */
        confirmed?: boolean;
        /** Digest returned by the preview being confirmed. */
        expectedDigest?: string;
    },
): Promise<types.plugins.Publication> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const os = await import('node:os');
    const { createHash } = await import('node:crypto');
    const name = String(opts.name ?? '');
    const git = (args: string[], allowFailure = false) => ctx.fns.plugins.cloneDir({ name, args, allowFailure, timeoutMs: 300_000 });
    const { dir } = await ctx.fns.plugins.cloneDir({ name }).catch(e => {
        if (/not a git clone/.test(String(e?.message))) throw new Error(`${name} is a plain folder: put it under git first with plugins.gitInit({ name: "${name}" })`);
        throw e;
    });
    const st = await ctx.fns.plugins.cloneStatus({ dir });
    if (st.origin) throw new Error(`${name} already has an origin (${st.origin}): it is published — release new versions with plugins.release({ name: "${name}" })`);
    if (!st.branch) throw new Error(`${name} is on a detached HEAD: switch to a branch first (plugins.edit)`);
    if (st.dirty.length) throw new Error(`${name} has uncommitted changes — commit them first: ${st.dirty.join(', ')}`);
    const target = await ctx.fns.plugins.repoUrl({ repo: opts.repo });
    
    const pkgFile = path.join(dir, 'package.json');
    const text = await fs.readFile(pkgFile, 'utf8');
    const pkg = JSON.parse(text);
    const version = String(opts.version ?? pkg.version ?? '1.0.0').replace(/^v/, '');
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version must be X.Y.Z');
    const tag = 'v' + version;
    if ((await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], true)).ok) throw new Error(`Tag ${tag} already exists in the clone`);
    
    // The same gate as every later release: package checks of an install, bun.lock, the plugin's tests.
    const { plugin, tests } = await ctx.fns.plugins.releaseCheck({ name });
    
    // What the listing says about this plugin, taken from its own package.json.
    const procs = pkg.procs ?? {};
    const entry = {
        name,
        label: String(procs.label ?? name),
        ...(typeof procs.icon === 'string' && /^ph-[a-z0-9-]+$/.test(procs.icon) ? { icon: procs.icon as string } : {}),
        description: String(procs.description ?? ''),
        source: target.source,
    };
    if (!entry.description) throw new Error(`${name} has no procs.description in package.json: the catalog needs one sentence about what it does`);
    // A name the catalog already gives to another repository would make two different plugins answer to one name.
    const known = await ctx.fns.plugins.listing({}).then(l => l.plugins.find(p => p.name === name), () => undefined);
    if (known && (await ctx.fns.plugins.repoUrl({ repo: known.source })).key !== target.key)
        throw new Error(`The catalog already lists a plugin named ${name} from ${known.source}: choose another name`);
    
    // The target repository: reachable and empty, or (GitHub only) missing and created on confirm.
    const run = async (cwd: string, args: string[], env: Record<string, string> = {}) => {
        const p = Bun.spawn(['git', ...args], { cwd, stdout: 'pipe', stderr: 'pipe', env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } });
        const timer = setTimeout(() => p.kill(), 120_000);
        const [out, err, code] = [await new Response(p.stdout).text(), await new Response(p.stderr).text(), await p.exited];
        clearTimeout(timer);
        return { ok: code === 0, out: out.trim(), err: (err.trim().split('\n').at(-1) ?? String(code)).slice(0, 300) };
    };
    let remote: 'empty' | 'missing' = 'empty';
    let creates: { repo: string; visibility: 'public' | 'private' } | undefined;
    const seen = await run(dir, ['ls-remote', target.url]);
    if (seen.ok) {
        // HEAD is a pointer to a branch, not a ref of its own: count branches and tags.
        const refs = seen.out.split('\n').filter(l => l && !l.endsWith('\tHEAD')).length;
        if (refs) throw new Error(`${target.source} is not empty (${refs} ${refs === 1 ? 'ref' : 'refs'}): the first publication needs an empty repository`);
    } else if (target.github && target.kind === 'github') {
        const gh = await ctx.fns.plugins.ghRepo({ repo: target.github });
        if (gh.exists) throw new Error(`Cannot read ${target.source} with git although it exists: ${seen.err}`);
        if (!opts.createRepo) throw new Error(`${target.source} does not exist: create it, or repeat with createRepo: true to have it created (private unless visibility: "public")`);
        remote = 'missing';
        creates = { repo: target.github, visibility: opts.visibility === 'public' ? 'public' : 'private' };
    } else {
        throw new Error(`Cannot reach ${target.source}: ${seen.err}. Create an empty repository on that server and make sure this machine has git access to it (credential helper or ssh key).`);
    }
    
    // package.json at the release: its version, and where the plugin lives.
    const repositoryUrl = target.github ? `https://github.com/${target.github}` : target.url;
    const next = { ...pkg, version, repository: { type: 'git', url: repositoryUrl } };
    const packageChanges = [
        ...(pkg.version !== version ? [`version: ${pkg.version ?? '(none)'} → ${version}`] : []),
        ...(pkg.repository?.url !== repositoryUrl ? [`repository: ${pkg.repository?.url ?? '(none)'} → ${repositoryUrl}`] : []),
    ];
    
    // The listing repository, when one is given: plugins/<name>.json plus the generated index.json (format 2).
    const tmp = await fs.mkdtemp(path.join(os.tmpdir(), 'hyper-plugin-listing-'));
    try {
        let listing: types.plugins.Publication['listing'] = { status: 'not-requested' };
        let listingDir = '';
        if (opts.listing) {
            const l = await ctx.fns.plugins.repoUrl({ repo: opts.listing });
            listingDir = path.join(tmp, 'listing');
            const cloned = await run(tmp, ['clone', '-q', '--depth', '1', l.url, listingDir]);
            if (!cloned.ok) throw new Error(`Cannot read the listing repository ${l.source}: ${cloned.err}`);
            const index = JSON.parse(await fs.readFile(path.join(listingDir, 'index.json'), 'utf8').catch(() => 'null'));
            if (index?.format !== 2 || !Array.isArray(index.plugins) || !(await fs.lstat(path.join(listingDir, 'plugins')).catch(() => null))?.isDirectory())
                throw new Error(`${l.source} is not a plugin listing: it needs plugins/<name>.json files and an index.json of format 2`);
            const there = JSON.parse(await fs.readFile(path.join(listingDir, 'plugins', name + '.json'), 'utf8').catch(() => 'null'));
            if (there && (await ctx.fns.plugins.repoUrl({ repo: String(there.source) }).catch(() => ({ key: '' }))).key !== target.key)
                throw new Error(`The listing ${l.source} already has a plugin named ${name} from ${there.source}`);
            listing = { status: there ? 'already-listed' : 'will-add', repo: l.source };
        }
    
        // Found in the live run: a listing other people read is of no use to them when the plugin's repository is
        // private — they see the entry and cannot install it (and the public listing's own check fails on it).
        if (listing.status === 'will-add' && target.github) {
            const visibility = creates?.visibility ?? (await ctx.fns.plugins.ghRepo({ repo: target.github }).catch(() => null))?.visibility;
            if (visibility === 'private') listing.detail = `${target.source} is private: only people with access to it can install the plugin from this listing`;
        }
        const result: types.plugins.Publication = {
            name, version, tag, repo: target.source, url: target.url, branch: st.branch, commit: st.commit!, remote,
            ...(creates ? { creates } : {}),
            packageChanges, files: plugin.files, tests, entry, listing,
            digest: createHash('sha256').update(JSON.stringify({
                name, repo: target.source, version, branch: st.branch, commit: st.commit, content: plugin.digest,
                creates: creates ?? null, listing: listing.repo ?? null,
            })).digest('hex'),
            status: 'preview',
        };
        if (!opts.confirmed) return result;
        if (opts.expectedDigest !== result.digest) throw new Error('Preview digest mismatch: preview again');
    
        // ── apply ─────────────────────────────────────────────────────────────
        if (creates) await ctx.fns.plugins.ghRepo({ repo: creates.repo, create: true, visibility: creates.visibility, description: `Hyper plugin: ${entry.description}`.slice(0, 300) });
        // A machine without a git identity still gets its commits, authored by Hyper.
        const known = (await git(['config', 'user.name'], true)).stdout && (await git(['config', 'user.email'], true)).stdout;
        const who: Record<string, string> = known ? {} : { GIT_AUTHOR_NAME: 'Hyper', GIT_AUTHOR_EMAIL: 'hyper@localhost', GIT_COMMITTER_NAME: 'Hyper', GIT_COMMITTER_EMAIL: 'hyper@localhost' };
        const before = st.commit!;
        const undo = async () => {
            // Nothing reached the server (or nothing it keeps): the clone goes back to how the preview saw it.
            await git(['tag', '-d', tag], true);
            await git(['remote', 'remove', 'origin'], true);
            await git(['reset', '-q', '--hard', before], true);
        };
        try {
            if (packageChanges.length) {
                await fs.writeFile(pkgFile, JSON.stringify(next, null, 2) + '\n');
                const c = await run(dir, ['commit', '-q', '-m', `Release ${tag}`, '--', 'package.json'], who);
                if (!c.ok) throw new Error(`git commit failed: ${c.err}`);
            }
            const t = await run(dir, ['tag', '-a', tag, '-m', `Release ${tag}`], who);
            if (!t.ok) throw new Error(`git tag failed: ${t.err}`);
            await git(['remote', 'add', 'origin', target.url]);
            const push = await git(['push', '-q', '-u', 'origin', `refs/heads/${st.branch}`, `refs/tags/${tag}`], true);
            if (!push.ok) throw new Error(`Push to ${target.source} failed: ${(push.stderr.split('\n').at(-1) ?? '').slice(0, 200)}`);
        } catch (cause) {
            await undo();
            throw new Error(`${cause instanceof Error ? cause.message : String(cause)}. Nothing published; the clone is as before${creates ? ` (the repository ${creates.repo} was created and is empty)` : ''}.`, { cause });
        }
        const commit = (await git(['rev-parse', `${tag}^{commit}`])).stdout;
        const { lock } = await ctx.fns.plugins.lockFile({});
        lock.plugins[name] = { repo: target.source, tag, commit, previous: [] };
        await ctx.fns.plugins.lockFile({ lock });
        let at: 'tag' | 'branch' = 'branch';
        if (!opts.keepBranch) { await git(['checkout', '-q', '--detach', `refs/tags/${tag}`]); at = 'tag'; }
    
        // The listing comes last: its checks look for the tag in the plugin's repository.
        if (listing.status === 'will-add') {
            await fs.writeFile(path.join(listingDir, 'plugins', name + '.json'), JSON.stringify(entry, null, 2) + '\n');
            const KEYS = ['name', 'label', 'icon', 'description', 'source'];
            const all: Array<Record<string, unknown>> = [];
            for (const file of (await fs.readdir(path.join(listingDir, 'plugins'))).filter(f => f.endsWith('.json')).sort()) {
                const p = JSON.parse(await fs.readFile(path.join(listingDir, 'plugins', file), 'utf8'));
                all.push(Object.fromEntries(KEYS.filter(k => p[k] !== undefined).map(k => [k, p[k]])));
            }
            await fs.writeFile(path.join(listingDir, 'index.json'), JSON.stringify({ format: 2, plugins: all }, null, 2) + '\n');
            await run(listingDir, ['add', '--', `plugins/${name}.json`, 'index.json']);
            const idKnown = (await run(listingDir, ['config', 'user.name'])).out && (await run(listingDir, ['config', 'user.email'])).out;
            const c = await run(listingDir, ['commit', '-q', '-m', `${name} ${version}`], idKnown ? {} : { GIT_AUTHOR_NAME: 'Hyper', GIT_AUTHOR_EMAIL: 'hyper@localhost', GIT_COMMITTER_NAME: 'Hyper', GIT_COMMITTER_EMAIL: 'hyper@localhost' });
            const pushed = c.ok ? await run(listingDir, ['push', '-q', 'origin', 'HEAD']) : c;
            listing = pushed.ok
                ? { status: 'added', repo: listing.repo, commit: (await run(listingDir, ['rev-parse', 'HEAD'])).out }
                : { status: 'push-refused', repo: listing.repo, detail: `${pushed.err} — the plugin is published; open a pull request to the listing with \`entry\` as plugins/${name}.json` };
        }
        // The catalog caches tags and listings for a few minutes: forget what it knew about this repository.
        (ctx.state as { pluginVersions?: Map<string, unknown> }).pluginVersions?.clear();
        await ctx.fns.procs.modules.reload({}).catch(() => undefined);
        return { ...result, commit, listing, at, status: 'published' };
    } finally {
        await fs.rm(tmp, { recursive: true, force: true });
    }
}
