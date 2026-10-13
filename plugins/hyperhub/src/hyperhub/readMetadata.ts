/**
 * Reads bounded regular-file plugin metadata without following symbolic links
 *
 * Internal safety helper for local package manifests and installation provenance. Rejects links, oversized files and non-object JSON before inventory or lifecycle decisions.
 * @param opts.path Absolute path of the package or provenance JSON file.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Absolute path of the package or provenance JSON file. */
        path: string;
    },
): Promise<Record<string, string | undefined>> {
    return await ctx.fns.plugins.readMetadata({path:opts.path}) as Record<string,string|undefined>;
}
