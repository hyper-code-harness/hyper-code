/** Returns the "who is online" avatar row (auth.online) as an HTML fragment for its live region. */
export default async function (ctx: Context, _session: Session | null, _opts: { req: Request; params: Record<string, string> }) {
    const html = ctx.fns.ui.live({ id: "online-now", url: "/auth/online", topic: "presence", every: 60, html: await ctx.fns.auth.online({}), attrs: 'data-agent-meta-label class="flex shrink-0 items-center"' });
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
