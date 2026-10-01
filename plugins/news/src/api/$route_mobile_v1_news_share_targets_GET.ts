/** Lists registered News share adapters and their destinations for the guarded native share picker. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const targets = await ctx.fns.news.shareTargets({});
    const result = [];
    for (const target of targets) {
        let destinations: any[] = [];
        try { destinations = await ctx.fns.news.shareDestinations({ target: target.target }); } catch {}
        result.push({ target: target.target, label: target.label, destinations: destinations.map((item: any) => ({ id: String(item.id), label: String(item.label), kind: item.kind == null ? null : String(item.kind), favorite: item.favorite === true, shareCount: Number(item.shareCount ?? 0) })) });
    }
    return Response.json({ version: 1, targets: result });
}
