/** POST /whisper/live — raw 16 kHz mono WAV body (?model=&language=&prompt=) → fast JSON transcription via the resident whisper-server. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const req = opts.req;
    if (req.headers.get("sec-fetch-site") === "cross-site") return new Response("same-origin only", { status: 403 });
    try {
        const q = new URL(req.url).searchParams;
        const srv = await ctx.fns.whisper.ensureServer({ model: q.get("model") || undefined });
        const fd = new FormData();
        fd.append("file", new Blob([await req.arrayBuffer()], { type: "audio/wav" }), "a.wav");
        fd.append("response_format", "json");
        fd.append("temperature", "0");
        fd.append("language", q.get("language") || "auto");
        if (q.get("prompt")) fd.append("prompt", q.get("prompt")!);
        const t = performance.now();
        const r = await fetch(`${srv.url}/inference`, { method: "POST", body: fd });
        const j: any = await r.json();
        const text = String(j.text ?? "").trim().replace(/\s*\n\s*/g, " ");
        return Response.json({ text, model: srv.model, whisperMs: Math.round(performance.now() - t), error: j.error });
    } catch (e: any) {
        return Response.json({ error: String(e?.message ?? e) }, { status: 500 });
    }
}
