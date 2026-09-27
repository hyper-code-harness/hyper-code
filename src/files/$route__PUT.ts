// PUT /files?path=... — save raw text body. Used by the CodeMirror autosave.
/** Handles the corresponding HTTP route. */
export default async function (ctx: Context, _session: Session | null, opts: { /** Incoming HTTP request. */ req: Request; /** Route parameters. */ params: Record<string, string> }) {
    const url = new URL(opts.req.url);
    const path = url.searchParams.get("path") ?? "";
    if (!path) return new Response("missing ?path", { status: 400 });
    const host = url.searchParams.get("host") || undefined;
    if (host && !(await ctx.fns.remote.servers({})).some(s => s.name === host)) return new Response("unknown host", { status: 400 });
    const content = await opts.req.text();
    await ctx.fns.files.write({ path, content, host });
    return new Response(JSON.stringify({ ok: true, bytes: content.length }), {
        headers: { "content-type": "application/json" },
    });
}
