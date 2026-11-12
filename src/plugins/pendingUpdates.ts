/**
 * Returns the plugin updates found by the last check that still apply, read from disk without contacting any repository
 *
 * Use on a page, in a menu or before suggesting an update, wherever asking the repositories would be too slow: it reads what plugins.checkUpdates last recorded and drops every entry whose clone has moved since (updated, rolled back, switched to another ref or removed), so an applied update disappears at once. `checkedAt` says how old the answer is; null means no check has run yet. Returns an empty list when USER_PLUGINS is not configured or the record is missing or unreadable. For a current answer call plugins.checkUpdates.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {},
): Promise<{ checkedAt: string | null; updates: types.plugins.PendingUpdate[]; errors: string[] }> {
    const fs = await import('node:fs/promises');
    const path = await import('node:path');
    const none = { checkedAt: null, updates: [] as types.plugins.PendingUpdate[], errors: [] as string[] };
    let info: Awaited<ReturnType<typeof ctx.fns.plugins.lockFile>>;
    try { info = await ctx.fns.plugins.lockFile({}); } catch { return none; }
    const raw = await fs.readFile(path.join(path.dirname(info.path), 'plugins.updates.json'), 'utf8').then(JSON.parse, () => null);
    if (!raw || typeof raw !== 'object' || !Array.isArray(raw.updates)) return none;
    // Only what is still true: an entry found for a clone that has moved since (updated, rolled back, switched, removed) is dropped.
    const updates = (raw.updates as types.plugins.PendingUpdate[]).filter(u => {
        const e = u && typeof u.name === 'string' ? info.lock.plugins[u.name] : undefined;
        return !!e && e.commit === u.installedCommit && (u.mode === 'branch' ? e.branch === u.from : e.tag === u.from);
    });
    return {
        checkedAt: typeof raw.checkedAt === 'string' ? raw.checkedAt : null,
        updates,
        errors: Array.isArray(raw.errors) ? raw.errors.map(String).slice(0, 50) : [],
    };
}
