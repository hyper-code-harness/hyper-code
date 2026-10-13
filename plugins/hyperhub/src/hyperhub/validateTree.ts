/**
 * Validates a local plugin tree before registry publication or activation
 *
 * Validates a local plugin tree before registry publication or activation.

Rejects links, dependencies, lifecycle scripts, unsafe names and paths, embedded repositories and oversized trees. This is structural validation, not a code sandbox or trust assessment.
 * @param opts.dir Absolute staging or source directory outside automatic plugin mounts.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute staging or source directory outside automatic plugin mounts. */
        dir: string;
    },
): Promise<{name:string;src:string;files:string[];digest:string}> {
    return await ctx.fns.plugins.validateTree({dir:opts.dir});
}
