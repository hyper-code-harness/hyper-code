/** Return quota usage of the providers the calling node client may use.
 * @param opts.req Incoming request. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming request. */ req: Request }): Promise<Response> {
    const auth = await ctx.fns.node.authorize({ req: opts.req });
    if (!auth.ok) return auth.response;
    const allow = new Set(auth.client.providers);
    const usage = (await ctx.fns.llm.usageOverview({})).filter((u) => !allow.size || allow.has(u.provider))
        .map((u) => ({ provider: u.provider, account: u.account, usedPercent: u.usedPercent, resetsAt: u.resetsAt, planType: u.planType, parkedAgents: u.parkedAgents }));
    return Response.json({ usage }, { headers: { "cache-control": "no-store" } });
}
