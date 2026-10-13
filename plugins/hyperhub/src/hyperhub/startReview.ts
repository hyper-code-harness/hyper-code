/**
 * Opens a review agent for an explicitly selected immutable plugin
 *
 * Creates a review conversation on user request, with a safe pinned preview task. Does not activate or publish; the agent must inspect source and obtain fresh human confirmation before installation.
 * @param opts.baseUrl Credential-free HTTPS registry origin.
 * @param opts.repo Selected repository identifier.
 * @param opts.name Unscoped plugin basename.
 * @param opts.commit Exact 40 or 64 hexadecimal commit selected for review.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Credential-free HTTPS registry origin. */
        baseUrl: string;
        /** Selected repository identifier. */
        repo: string;
        /** Unscoped plugin basename. */
        name: string;
        /** Exact 40 or 64 hexadecimal commit selected for review. */
        commit: string;
    },
): Promise<{id:string}> {
    const u = new URL(opts.baseUrl);
    if(u.protocol !== 'https:' || u.username || u.password || u.pathname !== '/' || opts.baseUrl.includes('?') || opts.baseUrl.includes('#')) throw new Error('Invalid registry origin');
    if(!opts.repo.split('/').every(part => /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/.test(part)) || opts.repo.length>240 || !/^[a-z][a-z0-9-]*$/.test(opts.name) || !/^(?:[a-f0-9]{40}|[a-f0-9]{64})$/i.test(opts.commit)) throw new Error('Invalid pinned selection');
    const selection={provider:'hyperhub',name:opts.name,revision:opts.commit.toLowerCase(),source:{baseUrl:u.origin,repo:opts.repo}};
    const inventory=await ctx.fns.plugins.installed({});if(inventory.errors.length)throw new Error('Local inventory unavailable');
    const local=inventory.plugins.find(p=>p.name===opts.name);
    if(local&&(!local.managed||local.modified!==false||!local.selection||local.selection.provider!=='hyperhub'||local.selection.source.baseUrl!==u.origin||local.selection.source.repo!==opts.repo))throw new Error('Local provenance conflict');
    return ctx.fns.plugins.startReview({selection,operation:local?(local.previousSelection?.revision===selection.revision?'rollback':'update'):'install'});
}
