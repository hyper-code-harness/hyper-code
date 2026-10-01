/** Starts one autonomous News-focused agent with an explicit task from the native reader. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const body = await opts.req.json() as { prompt?: string };
    const result = await ctx.fns.news.startAgent({ id: opts.params.id!, prompt: body.prompt, run: true });
    return Response.json({ version: 1, ...result });
}
