/**
 * Forks an installed plugin's GitHub repository and rewires the clone: old origin becomes upstream, origin the fork
 *
 * Use when plugins.release refuses for lack of push rights, or to keep your own line of a plugin. Forks with gh
 * (plugins.ghFork), renames the clone's `origin` remote to `upstream` and adds the fork as `origin`, then fetches
 * it. Only for GitHub origins; a clone that already has an `upstream` remote is refused (it is a fork already).
 * Branches, tags and the plugin lock stay as they are; plugins.installed then reports fork: true.
 * @param opts.name Installed plugin name.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name. */
    name: string;
}): Promise<{ name: string; origin: string; upstream: string }> {
    const git = (args: string[], allowFailure = false) => ctx.fns.plugins.cloneDir({ name: opts.name, args, allowFailure });
    const upstreamNow = await git(['config', '--get', 'remote.upstream.url'], true);
    if (upstreamNow.ok) throw new Error(`${opts.name} already has an upstream remote (${upstreamNow.stdout}): it is a fork`);
    const origin = (await git(['config', '--get', 'remote.origin.url'])).stdout;
    const m = /github\.com[:/]([A-Za-z0-9-]+\/[A-Za-z0-9._-]+?)(?:\.git)?\/?$/.exec(origin);
    if (!m) throw new Error(`Only GitHub repositories can be forked; origin is ${origin}`);
    const fork = await ctx.fns.plugins.ghFork({ repo: m[1]! });
    await git(['remote', 'rename', 'origin', 'upstream']);
    await git(['remote', 'add', 'origin', fork.url]);
    // A brand-new fork can take a moment to appear; the remotes are set either way.
    await git(['fetch', '-q', 'origin'], true);
    return { name: opts.name, origin: fork.url, upstream: origin };
}
