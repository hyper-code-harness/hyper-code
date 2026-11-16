/**
 * Registers an already published plugin in a plugin listing, or refreshes its entry there — without making a release
 *
 * Use when a plugin's repository is published but the listing does not show it: the first publication could not
 * write the listing (plugins.publish answered `push-refused`), the plugin was published before a listing existed,
 * or its label, icon or description changed. The entry is built from the plugin's package.json and its origin; the
 * listing defaults to the one of this Hyper's network (plugins.home). The first call is a preview and changes
 * nothing; `confirmed: true` with the preview's digest writes the entry (plugins.listingWrite: one commit, retried
 * when others publish at the same moment). It refuses a plugin that has no origin or no release tag there, because
 * a listing entry nobody can install from helps no one, and never touches an entry of the same name that points at
 * another repository.
 * @param opts.name Plugin name: a published clone in USER_PLUGINS (it has an origin).
 * @param opts.listing Address of the listing repository; defaults to the listing of plugins.home.
 * @param opts.confirmed Write the previewed entry. @default false
 * @param opts.expectedDigest Digest returned by the preview being confirmed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Plugin name: a published clone in USER_PLUGINS (it has an origin). */
    name: string;
    /** Address of the listing repository; defaults to the listing of plugins.home. */
    listing?: string;
    /** Write the previewed entry. @default false */
    confirmed?: boolean;
    /** Digest returned by the preview being confirmed. */
    expectedDigest?: string;
}): Promise<{
    name: string;
    /** The plugin's repository, as the entry records it. */
    repo: string;
    /** The listing repository. */
    listing: string;
    entry: { name: string; label: string; icon?: string; description: string; source: string; publishedBy?: string };
    /** Latest release tag found in the plugin's repository. */
    latest: string;
    /** `preview` — nothing written; `added` / `updated` / `unchanged` — the listing has this entry; `refused` — the listing did not take it. */
    status: 'preview' | 'added' | 'updated' | 'unchanged' | 'refused';
    commit?: string;
    detail?: string;
    digest: string;
}> {
    const { createHash } = await import('node:crypto');
    const name = String(opts.name ?? '');
    const { dir } = await ctx.fns.plugins.cloneDir({ name });
    const st = await ctx.fns.plugins.cloneStatus({ dir });
    if (!st.origin) throw new Error(`${name} is not published yet: publish it first with plugins.publish({ name: "${name}" })`);
    const target = await ctx.fns.plugins.repoUrl({ repo: st.origin });
    const home = opts.listing ? null : await ctx.fns.plugins.home({});
    const listing = opts.listing ?? home?.listing;
    if (!listing) throw new Error(`Give a listing repository (listing): ${home?.problems.join('; ') || 'plugins.home names none'}`);
    const l = await ctx.fns.plugins.repoUrl({ repo: listing });
    const latest = (await ctx.fns.plugins.versions({ source: target.source, fresh: true }))[0];
    if (!latest) throw new Error(`${target.source} has no vX.Y.Z release tag: nobody could install ${name} from the listing`);
    // Recorded as the publisher only when this Hyper publishes into its own place in the network.
    const mine = home?.ready && home.repo && (await ctx.fns.plugins.repoUrl({ repo: home.repo.replace('<name>', name) })).key === target.key;
    const entry = await ctx.fns.plugins.listingEntryOf({ name, source: target.source, ...(mine && home?.publishedBy ? { publishedBy: home.publishedBy } : {}) });
    const digest = createHash('sha256').update(JSON.stringify({ name, listing: l.source, entry })).digest('hex');
    const result = { name, repo: target.source, listing: l.source, entry, latest: latest.tag, digest };
    if (!opts.confirmed) return { ...result, status: 'preview' };
    if (opts.expectedDigest !== digest) throw new Error('Preview digest mismatch: preview again');
    const w = await ctx.fns.plugins.listingWrite({ listing, name, entry, source: target.source, message: `${name} ${latest.version}` });
    return { ...result, status: w.status === 'refused' ? 'refused' : w.status as 'added' | 'updated' | 'unchanged', ...(w.commit ? { commit: w.commit } : {}), ...(w.detail ? { detail: w.detail } : {}) };
}
