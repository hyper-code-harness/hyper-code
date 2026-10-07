/** Serves this instance's browser tab icon (ui.faviconUrl) at /favicon.ico for pages and browsers that ask for it by URL. */
export default async function (ctx: Context, _session: Session | null, _opts: {
        /** Incoming HTTP request. */ req: Request;
        /** Route parameters captured from the request path. */ params: Record<string, string> }): Promise<Response> {
    const url = await ctx.fns.ui.faviconUrl({});
    const m = /^data:([^;,]+)(;base64)?,(.*)$/s.exec(url);
    if (!m) return new Response("no favicon", { status: 404 });
    const body = m[2] ? Buffer.from(m[3]!, "base64") : decodeURIComponent(m[3]!);
    return new Response(body, { headers: { "content-type": m[1]!, "cache-control": "no-cache" } });
}
