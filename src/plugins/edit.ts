/**
 * Switches an installed plugin clone from its detached release tag to a branch so it can be edited and committed
 *
 * Use before changing a plugin's code in USER_PLUGINS/<name>. Without `branch` it switches to `main` (created from
 * origin/main after a fetch when there is no local one); with a new branch name it creates that branch at the
 * current commit, so the edit starts exactly from the installed release; an existing branch is switched to.
 * Uncommitted changes are carried over when git allows it. Remounts plugins afterwards, since the files may differ.
 * @param opts.name Installed plugin name.
 * @param opts.branch Branch to work on; a name that does not exist yet is created at HEAD. @default "main"
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Installed plugin name. */
    name: string;
    /** Branch to work on; a name that does not exist yet is created at HEAD. @default "main" */
    branch?: string;
}): Promise<{ name: string; branch: string; created: boolean; commit: string; from: string }> {
    const branch = opts.branch ?? 'main';
    if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,99}$/.test(branch) || branch.includes('..') || branch.endsWith('.lock'))
        throw new Error('Invalid branch name');
    const git = (args: string[], allowFailure = false) => ctx.fns.plugins.cloneDir({ name: opts.name, args, allowFailure });
    const from = (await git(['rev-parse', 'HEAD'])).stdout;
    const local = (await git(['rev-parse', '--verify', '--quiet', `refs/heads/${branch}`], true)).ok;
    let created = false;
    if (local) await git(['switch', '-q', branch]);
    else {
        await git(['fetch', '-q', 'origin'], true);
        const remote = (await git(['rev-parse', '--verify', '--quiet', `refs/remotes/origin/${branch}`], true)).ok;
        if (remote) await git(['switch', '-q', '-c', branch, '--track', `origin/${branch}`]);
        else { await git(['switch', '-q', '-c', branch]); created = true; }
    }
    const commit = (await git(['rev-parse', 'HEAD'])).stdout;
    if (commit !== from) await ctx.fns.procs.modules.reload({});
    return { name: opts.name, branch, created, commit, from };
}
