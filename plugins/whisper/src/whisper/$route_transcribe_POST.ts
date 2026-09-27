/** POST /whisper/transcribe — multipart form (audio, model, language, prompt) → JSON transcription result. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const req = opts.req;
    if (req.headers.get("sec-fetch-site") === "cross-site") return new Response("same-origin only", { status: 403 });
    try {
        const f = await req.formData();
        const audio = f.get("audio");
        if (!(audio instanceof Blob) || audio.size === 0) return Response.json({ error: "audio is required" }, { status: 400 });
        const s = (k: string) => { const v = f.get(k); return typeof v === "string" && v.trim() ? v.trim() : undefined; };
        const r = await ctx.fns.whisper.transcribe({
            audio: new Uint8Array(await audio.arrayBuffer()),
            model: s("model"), language: s("language"), prompt: s("prompt"), translate: s("translate") === "1",
        });
        return Response.json(r);
    } catch (e: any) {
        return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
    }
}
