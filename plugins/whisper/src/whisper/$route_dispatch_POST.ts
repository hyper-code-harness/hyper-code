/** POST /whisper/dispatch — JSON { text, focusAgentId? } → whisper.dispatch decision (logged only, not executed). */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    if (opts.req.headers.get("sec-fetch-site") === "cross-site") return new Response("same-origin only", { status: 403 });
    try {
        const b: any = await opts.req.json();
        return Response.json(await ctx.fns.whisper.dispatch({ text: String(b.text ?? ""), focusAgentId: b.focusAgentId || undefined }));
    } catch (e: any) { return Response.json({ error: String(e?.message ?? e) }, { status: 500 }); }
}
