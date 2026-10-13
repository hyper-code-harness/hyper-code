/**
 * Reads current plugin metadata from a Hyper-git registry
 *
 * Reads current plugin metadata from a Hyper-git registry.

Read-only registry HTTP request. Uses existing network identity; never accepts credentials embedded in URLs. Registry must be enabled on the server. Returns server JSON without loading or executing plugin code.
 * @param opts.baseUrl Hyper-git HTTPS service origin without credentials, query or fragment.
 * @param opts.repo Repository identifier; required for resource-scoped access.
 * @param opts.name Exact package.json plugin name.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Hyper-git HTTPS service origin without credentials, query or fragment. */
        baseUrl: string;
        /** Repository identifier; required for resource-scoped access. */
        repo: string;
        /** Exact package.json plugin name. */
        name: string;
    },
): Promise<Record<string, unknown>> {
    return await ctx.fns.hyperhub.registryRequest({ ...opts, action: "get" });
}
