/**
 * Resolves a plugin to an immutable Hyper-git commit
 *
 * Resolves a plugin to an immutable Hyper-git commit.

Read-only registry HTTP request. Uses existing network identity; never accepts credentials embedded in URLs. Registry must be enabled on the server. Returns server JSON without loading or executing plugin code.
 * @param opts.baseUrl Hyper-git HTTPS service origin without credentials, query or fragment.
 * @param opts.repo Repository identifier; required for resource-scoped access.
 * @param opts.name Exact package.json plugin name.
 * @param opts.commit Exact 40 or 64 character hexadecimal commit; omitted resolves current default branch.
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
        /** Exact 40 or 64 character hexadecimal commit; omitted resolves current default branch. */
        commit?: string;
    },
): Promise<Record<string, unknown>> {
    return await ctx.fns.hyperhub.registryRequest({ ...opts, action: "resolve" });
}
