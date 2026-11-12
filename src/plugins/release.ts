/**
 * Releases an edited plugin clone: runs its tests, bumps the version, commits, tags vX.Y.Z and pushes branch and tag
 *
 * Use after editing a plugin in USER_PLUGINS/<name> on a branch (plugins.edit) to publish the change as a new
 * release that plugins.install and other machines can pick up. Refuses on a detached HEAD, with uncommitted
 * changes, when the tag already exists, and when origin does not accept a push (checked with `git push --dry-run`
 * before anything else) — then fork the repository with plugins.fork and release to the fork. A plugin with npm
 * dependencies must have its bun.lock committed and matching package.json (`bun install --frozen-lockfile
 * --dry-run`), because plugins.install installs exactly from it and would refuse the release. Runs the plugin's
 * tests through Hyper's script/plugin-test.ts when it has *.test.ts files; a failure stops the release. Sets
 * package.json version (default: patch + 1), commits "Release vX.Y.Z", tags it, pushes the branch and the tag to
 * origin and moves the plugin lock to the new tag, keeping the previous one for rollback.
 * @param opts.name Installed plugin name.
 * @param opts.version Version to release, X.Y.Z; defaults to the package.json version with patch + 1.
 * @param opts.keepBranch Stay on the branch after the release instead of moving the clone to the released tag. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name. */
    name: string;
    /** Version to release, X.Y.Z; defaults to the package.json version with patch + 1. */
    version?: string;
    /** Stay on the branch after the release instead of moving the clone to the released tag. @default false */
    keepBranch?: boolean;
}): Promise<{ name: string; version: string; tag: string; commit: string; branch: string; at: 'tag' | 'branch'; pushed: string; tests: { ran: boolean; output: string } }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const git = (args: string[], allowFailure = false) => ctx.fns.plugins.cloneDir({ name: opts.name, args, allowFailure, timeoutMs: 300_000 });
    const { dir } = await ctx.fns.plugins.cloneDir({ name: opts.name });
    const st = await ctx.fns.plugins.cloneStatus({ dir });
    if (!st.branch) throw new Error(`${opts.name} is on a detached release tag: call plugins.edit first to work on a branch`);
    if (st.dirty.length) throw new Error(`${opts.name} has uncommitted changes — commit them first: ${st.dirty.join(', ')}`);
    const pkgFile = path.join(dir, 'package.json');
    const text = await fs.readFile(pkgFile, 'utf8');
    const pkg = JSON.parse(text);
    const current = String(pkg.version ?? '0.0.0');
    let version = opts.version?.replace(/^v/, '');
    if (!version) {
        const m = /^(\d+)\.(\d+)\.(\d+)/.exec(current);
        if (!m) throw new Error(`package.json version ${current} is not X.Y.Z; pass version`);
        version = `${m[1]}.${m[2]}.${Number(m[3]) + 1}`;
    }
    if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error('Version must be X.Y.Z');
    const tag = 'v' + version;
    if ((await git(['rev-parse', '--verify', '--quiet', `refs/tags/${tag}`], true)).ok) throw new Error(`Tag ${tag} already exists`);
    if (!st.origin) throw new Error(`${opts.name} has no origin remote: it was never published — the first release goes through plugins.publish({ name: "${opts.name}", repo })`);
    const probe = await git(['push', '--dry-run', '--porcelain', 'origin', `HEAD:refs/heads/${st.branch}`], true);
    if (!probe.ok)
        throw new Error(`No push rights to ${st.origin}: ${(probe.stderr.split('\n').at(-1) ?? '').slice(0, 200)}. Fork it with plugins.fork({ name: "${opts.name}" }) and release to your fork.`);

    // The checks every release passes, the first one (plugins.publish) included: package checks of an install, bun.lock, tests.
    const { tests } = await ctx.fns.plugins.releaseCheck({ name: opts.name });
    const bumped = /"version"\s*:\s*"[^"]*"/.test(text)
        ? text.replace(/"version"\s*:\s*"[^"]*"/, `"version": "${version}"`)
        : JSON.stringify({ ...pkg, version }, null, 2) + '\n';
    if (bumped !== text) {
        await fs.writeFile(pkgFile, bumped);
        await git(['-c', 'user.useConfigOnly=false', 'commit', '-q', '-m', `Release ${tag}`, '--', 'package.json']);
    }
    await git(['tag', '-a', tag, '-m', `Release ${tag}`]);
    const commit = (await git(['rev-parse', 'HEAD'])).stdout;
    const push = await git(['push', '-q', '--porcelain', 'origin', `HEAD:refs/heads/${st.branch}`, `refs/tags/${tag}`], true);
    if (!push.ok) {
        await git(['tag', '-d', tag], true);
        throw new Error(`Push to ${st.origin} failed; tag ${tag} removed locally, the version commit stays: ${(push.stderr.split('\n').at(-1) ?? '').slice(0, 200)}`);
    }
    const { lock } = await ctx.fns.plugins.lockFile({});
    const entry = lock.plugins[opts.name];
    if (entry) {
        // From any mode (tag, branch, commit) the lock moves to the new release tag; the old ref goes to previous.
        const was = entry.branch ? { branch: entry.branch } : entry.tag ? { tag: entry.tag } : {};
        lock.plugins[opts.name] = { repo: entry.repo, tag, commit, previous: [...entry.previous, { ...was, commit: entry.commit }].slice(-20) };
        await ctx.fns.plugins.lockFile({ lock });
    }
    // A released clone is an installed one: detached at its tag, as plugins.install leaves it, so the catalog shows
    // the release and the next update is not refused for "being on a branch". keepBranch stays for more edits.
    let at: 'tag' | 'branch' = 'branch';
    if (!opts.keepBranch) {
        await git(['checkout', '-q', '--detach', `refs/tags/${tag}`]);
        at = 'tag';
    }
    // This server just made a release: the few-minute cache of tags (plugins.versions) is out of date by definition.
    (ctx.state as { pluginVersions?: Map<string, unknown> }).pluginVersions?.clear();
    await ctx.fns.procs.modules.reload({}).catch(() => undefined);
    return { name: opts.name, version, tag, commit, branch: st.branch, at, pushed: st.origin, tests };
}
