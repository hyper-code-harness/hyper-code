/**
 * Counts the new upstream commits of a plugin clone that follows a branch, without changing its checkout
 *
 * Use for a plugin installed in branch mode (plugins.install({ name, branch })) to show "+N new" before an update:
 * asks origin for the branch head (git ls-remote, cached in memory for five minutes per clone), fetches that branch
 * into origin/<branch> only when the head is not in the clone yet, and lists the commits HEAD lacks. Never moves
 * HEAD or the branch: applying is plugins.install({ name }) with its preview and confirm. A clone in tag or commit
 * mode returns behind 0 without touching the network.
 * @param opts.name Installed plugin name (folder under USER_PLUGINS).
 * @param opts.fresh Ask origin again instead of using the five-minute cache. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name (folder under USER_PLUGINS). */
    name: string;
    /** Ask origin again instead of using the five-minute cache. @default false */
    fresh?: boolean;
}): Promise<{ name: string; branch?: string; head?: string; behind: number; commits: string[]; error?: string }> {
    const { lock } = await ctx.fns.plugins.lockFile({});
    const branch = lock.plugins[opts.name]?.branch;
    if (!branch) return { name: opts.name, behind: 0, commits: [] };
    const g = (args: string[]) => ctx.fns.plugins.cloneDir({ name: opts.name, args, allowFailure: true, timeoutMs: 30_000 });
    const { dir } = await ctx.fns.plugins.cloneDir({ name: opts.name });
    const cache: Map<string, { at: number; head: string }> = ((ctx.state as any).pluginBranchHeads ??= new Map());
    const key = `${dir}\0${branch}`;
    const hit = cache.get(key);
    let head = hit && opts.fresh !== true && Date.now() - hit.at < 5 * 60_000 ? hit.head : '';
    if (!head) {
        const remote = await g(['ls-remote', '--heads', 'origin', `refs/heads/${branch}`]);
        head = remote.ok ? remote.stdout.split(/\s+/)[0] ?? '' : '';
        if (!/^[0-9a-f]{40}$/.test(head)) return { name: opts.name, branch, behind: 0, commits: [], error: remote.ok ? `origin has no branch ${branch}` : 'origin unreachable' };
        cache.set(key, { at: Date.now(), head });
    }
    // Fetch only moves origin/<branch>; the checkout stays where the last reviewed update put it.
    if (!(await g(['cat-file', '-e', `${head}^{commit}`])).ok)
        await g(['fetch', '-q', 'origin', `+refs/heads/${branch}:refs/remotes/origin/${branch}`]);
    // Counted against HEAD each time, so an applied update shows 0 at once even from the cache.
    const count = await g(['rev-list', '--count', `HEAD..${head}`]);
    if (!count.ok) return { name: opts.name, branch, head, behind: 0, commits: [], error: 'branch head not in the clone' };
    const commits = (await g(['log', '--format=%h %s', '-n', '50', `HEAD..${head}`])).stdout.split('\n').filter(Boolean);
    return { name: opts.name, branch, head, behind: Number(count.stdout) || 0, commits };
}
