/**
 * Takes a plugin out of a plugin listing so that others no longer see it in their catalog — its repository, its releases and every installed copy stay as they are
 *
 * Use to withdraw a plugin you published: a demonstration that served its purpose, a plugin replaced by another, a
 * name published by mistake. It removes `plugins/<name>.json` and regenerates `index.json` in the listing repository
 * (plugins.listingWrite: one commit, retried when others publish at the same moment). Only an entry that points at
 * this plugin's own repository is removed — the repository is the clone's origin, or `repo` when the plugin is not on
 * this machine. Nothing is deleted on the git server, no tag moves, and Hypers that installed the plugin keep it and
 * simply stop seeing updates in the catalog. The first call is a preview; `confirmed: true` with its digest removes
 * the entry. Bring it back with plugins.addToListing.
 * @param opts.name Plugin name as the listing has it.
 * @param opts.listing Address of the listing repository; defaults to the listing of plugins.home.
 * @param opts.repo The plugin's repository, when it is not a clone on this machine.
 * @param opts.confirmed Remove the previewed entry. @default false
 * @param opts.expectedDigest Digest returned by the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name as the listing has it. */
    name: string;
    /** Address of the listing repository; defaults to the listing of plugins.home. */
    listing?: string;
    /** The plugin's repository, when it is not a clone on this machine. */
    repo?: string;
    /** Remove the previewed entry. @default false */
    confirmed?: boolean;
    /** Digest returned by the preview being confirmed. */
    expectedDigest?: string;
}): Promise<{
    name: string;
    /** The plugin's repository: untouched. */
    repo: string;
    /** The listing repository. */
    listing: string;
    /** `preview` — the entry is there and would be removed; `removed`; `absent` — the listing has no such entry; `refused` — the listing did not take the change. */
    status: 'preview' | 'removed' | 'absent' | 'refused';
    commit?: string;
    detail?: string;
    digest: string;
}> {
    const { createHash } = await import('node:crypto');
    const name = String(opts.name ?? '');
    if (!/^[a-z][a-z0-9-]{0,63}$/.test(name)) throw new Error('Invalid plugin name');
    let repo = opts.repo;
    if (!repo) {
        const clone = await ctx.fns.plugins.cloneDir({ name }).catch(() => null);
        repo = clone ? (await ctx.fns.plugins.cloneStatus({ dir: clone.dir })).origin : undefined;
        if (!repo) throw new Error(`${name} is not a published clone on this machine: say which repository it is (repo)`);
    }
    const target = await ctx.fns.plugins.repoUrl({ repo });
    const home = opts.listing ? null : await ctx.fns.plugins.home({});
    const listing = opts.listing ?? home?.listing;
    if (!listing) throw new Error(`Give a listing repository (listing): ${home?.problems.join('; ') || 'plugins.home names none'}`);
    const l = await ctx.fns.plugins.repoUrl({ repo: listing });
    const digest = createHash('sha256').update(JSON.stringify({ unpublish: name, listing: l.source, repo: target.source })).digest('hex');
    const result = { name, repo: target.source, listing: l.source, digest };
    if (!opts.confirmed) {
        // The same checks the removal makes, on the listing as it is now; an entry of another repository stops here.
        const w = await ctx.fns.plugins.listingWrite({ listing, name, entry: null, source: target.source, message: `remove ${name}`, dryRun: true });
        return { ...result, status: w.status === 'absent' ? 'absent' : 'preview' };
    }
    if (opts.expectedDigest !== digest) throw new Error('Preview digest mismatch: preview again');
    const w = await ctx.fns.plugins.listingWrite({ listing, name, entry: null, source: target.source, message: `remove ${name}` });
    return { ...result, status: w.status === 'removed' ? 'removed' : w.status === 'absent' ? 'absent' : 'refused', ...(w.commit ? { commit: w.commit } : {}), ...(w.detail ? { detail: w.detail } : {}) };
}
