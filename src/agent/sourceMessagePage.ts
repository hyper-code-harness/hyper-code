/**
 * Render one persisted chat message as a provenance source.
 *
 * Return an escaped read-only source message by durable agent ID and message index with a backlink to its chat, or 404 if it no longer exists. Used by the message source route.
 * @param opts.id Durable source agent identifier.
 * @param opts.idx Durable message index within the source agent. @minimum 0
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Durable source agent identifier. */
        id: string;
        /** Durable message index within the source agent. @minimum 0 */
        idx: number;
    },
): Promise<Response | { title: string; main: string }> {
    const idx = opts.idx;
    if (!Number.isSafeInteger(idx) || idx < 0) return new Response("Not Found", { status: 404 });
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT role, content FROM messages WHERE agent_id = ? AND idx = ?", params: [opts.id, idx] });
    const row = rows[0];
    if (!row) return new Response("Source message no longer available", { status: 404 });
    const esc = (text: string) => ctx.fns.w.escape({ text });
    return { title: `Source message ${idx}`, main: `<article class="mx-auto w-full max-w-4xl p-6"><nav><a class="text-primary underline" href="/agent/${encodeURIComponent(opts.id)}">Open source chat ${esc(opts.id)}</a></nav><h1 class="my-4 text-xl font-semibold">Message ${idx} · ${esc(String(row.role))}</h1><pre class="whitespace-pre-wrap break-words" tabindex="0">${esc(String(row.content ?? ""))}</pre></article>` };
}
