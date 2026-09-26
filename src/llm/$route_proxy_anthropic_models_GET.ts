/**
 * List Claude model ids the proxy host can serve to another Hyper instance.
 * @param opts.req Incoming request carrying the proxy bearer token.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Incoming request carrying the proxy bearer token. */
        req: Request;
    },
): Promise<Response> {
    const auth = await ctx.fns.llm.proxyAuthorize({ req: opts.req });
    if (!auth.ok) return auth.response;
    const all = await ctx.fns.llm.listModels({});
    const ids = ((all as any)["claude-code"] ?? []).map((m: string) => m.replace(/^claude-code:/, ""));
    return Response.json({ models: ids, host: ctx.fns.procs.project.name({}) }, { headers: { "cache-control": "no-store" } });
}
