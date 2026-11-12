/**
 * Asks the repositories of the installed plugins whether a newer release or new branch commits exist, and records what it finds — nothing is installed
 *
 * Use to learn which installed plugin clones can be updated; it runs once a day by itself ($cron_plugin-updates) and can be called at any time. Goes by the plugin lock, not by a listing, so a plugin installed straight from its repository on any git server is checked too: a clone at a release tag has an update when its repository has a newer vX.Y.Z tag (plugins.versions), a clone following a branch when that branch has new commits upstream (plugins.branchUpdates); a clone pinned to a commit is skipped. Writes the result to plugins.updates.json next to the lock, which plugins.pendingUpdates and the Dock badge read without touching the network. A repository that cannot be reached is reported in `errors` and does not hide the others. It never installs: apply an update with plugins.install({ name }) after reading its preview.
 * @param opts.fresh Ask the repositories now instead of using the few-minute cache of tags and branch heads. @default true
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Ask the repositories now instead of using the few-minute cache of tags and branch heads. @default true */
        fresh?: boolean;
    },
): Promise<{ checkedAt: string; checked: number; updates: types.plugins.PendingUpdate[]; errors: string[] }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    // A server without USER_PLUGINS has no plugin clones: the daily run has nothing to do and nothing to report.
    if (!String(ctx.env.USER_PLUGINS ?? '').trim() && !String(ctx.env.PLUGINS_LOCK ?? '').trim())
        return { checkedAt: new Date().toISOString(), checked: 0, updates: [], errors: [] };
    const { path: lockPath, lock } = await ctx.fns.plugins.lockFile({});
    // No clones recorded: nothing to ask and nothing to record (plugins.pendingUpdates drops stale entries by itself).
    if (!Object.keys(lock.plugins).length) return { checkedAt: new Date().toISOString(), checked: 0, updates: [], errors: [] };
    const fresh = opts.fresh !== false;
    const newer = (a: string, b: string) => {
        const x = a.split('.').map(Number), y = b.split('.').map(Number);
        return (x[0]! - y[0]! || x[1]! - y[1]! || x[2]! - y[2]!) > 0;
    };
    const updates: types.plugins.PendingUpdate[] = [];
    const errors: string[] = [];
    // From the lock, not from a listing: a plugin installed straight from its repository is checked too.
    await Promise.all(Object.entries(lock.plugins).map(async ([name, e]) => {
        try {
            if (e.branch) {
                const u = await ctx.fns.plugins.branchUpdates({ name, fresh });
                if (u.error) errors.push(`${name}: ${u.error}`);
                else if (u.behind > 0) updates.push({ name, mode: 'branch', from: e.branch, to: `${e.branch} +${u.behind}`, newCommits: u.behind, installedCommit: e.commit });
            } else if (e.tag && /^v\d+\.\d+\.\d+$/.test(e.tag)) {
                const latest = (await ctx.fns.plugins.versions({ source: e.repo, fresh }))[0];
                if (latest && newer(latest.version, e.tag.slice(1))) updates.push({ name, mode: 'tag', from: e.tag, to: latest.tag, installedCommit: e.commit });
            }
            // A plugin pinned to a commit follows nothing: it moves only by an explicit switch.
        } catch (cause) {
            errors.push(`${name}: ${(cause instanceof Error ? cause.message : String(cause)).slice(0, 200)}`);
        }
    }));
    updates.sort((a, b) => a.name.localeCompare(b.name));
    errors.sort();
    const result = { checkedAt: new Date().toISOString(), checked: Object.keys(lock.plugins).length, updates, errors };
    // Kept next to the lock so the Dock badge and pages read it without touching the network, also after a restart.
    const file = path.join(path.dirname(lockPath), 'plugins.updates.json');
    const tmp = `${file}.${process.pid}.${Date.now()}.tmp`;
    await fs.writeFile(tmp, JSON.stringify(result, null, 2) + '\n');
    await fs.rename(tmp, file);
    return result;
}
