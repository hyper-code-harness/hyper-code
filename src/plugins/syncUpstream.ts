/**
 * Fetches a forked plugin's upstream, reports how far the clone is behind and ahead, and merges it on request
 *
 * Use on a clone made a fork by plugins.fork (or with an `upstream` remote set by hand) to see new upstream work and
 * bring it in. Compares HEAD with upstream/<branch> (the upstream default branch when not given). With merge:true
 * on a branch with no uncommitted changes it runs `git merge --no-edit`; on a conflict it aborts the merge, leaving
 * the clone as it was, and lists the conflicting files. Remounts plugins after a merge that changed HEAD.
 * @param opts.name Installed plugin name.
 * @param opts.merge Merge upstream into the current branch. @default false
 * @param opts.branch Upstream branch to compare with; defaults to upstream's HEAD branch, else main.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name. */
    name: string;
    /** Merge upstream into the current branch. @default false */
    merge?: boolean;
    /** Upstream branch to compare with; defaults to upstream's HEAD branch, else main. */
    branch?: string;
}): Promise<{ name: string; upstream: string; ref: string; behind: number; ahead: number; merged: boolean; commit: string; conflicts?: string[] }> {
    const git = (args: string[], allowFailure = false) => ctx.fns.plugins.cloneDir({ name: opts.name, args, allowFailure });
    const url = await git(['remote', 'get-url', 'upstream'], true);
    if (!url.ok) throw new Error(`${opts.name} has no upstream remote: fork it with plugins.fork first`);
    if (opts.branch !== undefined && !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(opts.branch)) throw new Error('Invalid branch name');
    await git(['fetch', '-q', '--tags', 'upstream']);
    let branch = opts.branch;
    if (!branch) {
        await git(['remote', 'set-head', 'upstream', '--auto'], true);
        const head = await git(['symbolic-ref', '--quiet', '--short', 'refs/remotes/upstream/HEAD'], true);
        branch = head.ok && head.stdout ? head.stdout.replace(/^upstream\//, '') : 'main';
    }
    const ref = `upstream/${branch}`;
    if (!(await git(['rev-parse', '--verify', '--quiet', ref], true)).ok) throw new Error(`${ref} does not exist`);
    const count = async () => {
        const [ahead, behind] = (await git(['rev-list', '--left-right', '--count', `HEAD...${ref}`])).stdout.split(/\s+/).map(Number);
        return { ahead: ahead || 0, behind: behind || 0 };
    };
    let { ahead, behind } = await count();
    const before = (await git(['rev-parse', 'HEAD'])).stdout;
    let merged = false;
    let conflicts: string[] | undefined;
    if (opts.merge && behind > 0) {
        const st = await ctx.fns.plugins.cloneStatus({ dir: (await ctx.fns.plugins.cloneDir({ name: opts.name })).dir });
        if (!st.branch) throw new Error(`${opts.name} is on a detached tag: call plugins.edit first`);
        if (st.dirty.length) throw new Error(`${opts.name} has uncommitted changes — commit them first: ${st.dirty.join(', ')}`);
        const m = await git(['-c', 'user.useConfigOnly=false', 'merge', '--no-edit', ref], true);
        if (!m.ok) {
            conflicts = (await git(['diff', '--name-only', '--diff-filter=U'], true)).stdout.split('\n').filter(Boolean);
            await git(['merge', '--abort'], true);
            if (!conflicts.length) throw new Error(`Merge of ${ref} failed: ${(m.stderr.split('\n').at(-1) ?? '').slice(0, 200)}`);
        } else {
            merged = true;
            ({ ahead, behind } = await count());
        }
    }
    const commit = (await git(['rev-parse', 'HEAD'])).stdout;
    if (commit !== before) await ctx.fns.procs.modules.reload({});
    return { name: opts.name, upstream: url.stdout, ref, behind, ahead, merged, commit, ...(conflicts ? { conflicts } : {}) };
}
