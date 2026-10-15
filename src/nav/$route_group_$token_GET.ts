// GET /nav/group/:token — the late answer of one slow search source, drawn in place of its placeholder.
/** Waits for a slow search source started by nav.searchAll and returns its group HTML (empty when gone or empty). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }): Promise<Response> {
    const late: Record<string, Promise<string>> = ((ctx.state as any).nav ?? {}).lateGroups ?? {};
    const token = String(opts.params.token ?? "");
    const pending = late[token];
    delete late[token];
    const html = pending ? await pending.catch(() => "") : "";
    return new Response(html, { headers: { "content-type": "text/html; charset=utf-8", "cache-control": "no-store" } });
}
