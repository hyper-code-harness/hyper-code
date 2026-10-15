/**
 * Lists open browser tabs and their target metadata.
 */
export default async function (ctx: Context, _session: Session | null, _opts?: {}) {
    const scope = await ctx.fns.cdp.scope({});
    const browserUrl = ctx.fns.procs.env.cdpUrl({});
    const response = await fetch(`${browserUrl}/json`, { signal: AbortSignal.timeout(3000) });
    if (!response.ok) throw new Error(`Chrome CDP unavailable at ${browserUrl} (${response.status})`);
    const targets = await response.json() as any[];
    return targets
        .filter(target => target.type === "page" && (!scope.bound || target.id === scope.targetId))
        .map(target => ({ id: target.id, title: target.title, url: target.url }));
}
