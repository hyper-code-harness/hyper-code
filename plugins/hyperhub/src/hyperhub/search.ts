/**
 * Searches plugin metadata in a Hyper-git registry
 *
 * Searches plugin metadata in a Hyper-git registry.

Read-only registry HTTP request. Uses existing network identity; never accepts credentials embedded in URLs. Registry must be enabled on the server. Returns server JSON without loading or executing plugin code.
 * @param opts.baseUrl Hyper-git HTTPS service origin without credentials, query or fragment.
 * @param opts.repo Repository identifier; required for resource-scoped access.
 * @param opts.q Search text matched by the server.
 * @param opts.limit Maximum search results; omitted uses the server default. @minimum 1 @maximum 200
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Hyper-git HTTPS service origin without credentials, query or fragment. */
        baseUrl: string;
        /** Repository identifier; required for resource-scoped access. */
        repo?: string;
        /** Search text matched by the server. */
        q?: string;
        /** Maximum search results; omitted uses the server default. @minimum 1 @maximum 200 */
        limit?: number;
    },
): Promise<Record<string, unknown>> {
    return await ctx.fns.hyperhub.registryRequest({ ...opts, action: "search" });
}
