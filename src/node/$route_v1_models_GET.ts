/** Return the model catalogue this host offers to the calling node client.
 * @param opts.req Incoming request. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming request. */ req: Request }): Promise<Response> {
    const auth = await ctx.fns.node.authorize({ req: opts.req });
    if (!auth.ok) return auth.response;
    const models = await ctx.fns.node.catalog({ providers: auth.client.providers, excludeNode: auth.client.name, hops: auth.hops });
    return Response.json({ host: ctx.fns.procs.project.name({}), models }, { headers: { "cache-control": "no-store" } });
}
