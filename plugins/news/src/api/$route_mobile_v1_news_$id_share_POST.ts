/** Shares one stored News item through an explicit target and destination selected in the native confirmation UI. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const body = await opts.req.json() as { target?: string; destination?: string; text?: string };
    if (!body.target || !body.destination) return Response.json({ error: "invalid_request", message: "target and destination are required" }, { status: 400 });
    const result = await ctx.fns.news.share({ id: opts.params.id!, target: body.target, destination: body.destination, text: body.text, confirm: true });
    return Response.json({ version: 1, ...result });
}
