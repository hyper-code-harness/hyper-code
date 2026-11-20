/**
 * Serve one chat attachment by opaque identifier
 *
 * Streams an attachment after checking that it belongs to the requesting
 * agent or appears in its inherited transcript.
 * @param opts.id Opaque attachment ID.
 * @param opts.agentId Requesting agent ID.
 * @param opts.method GET or HEAD method. @default GET
 */
export default async function (ctx: Context, _session: Session | null, opts: { /** Opaque attachment ID. */ id: string; /** Requesting agent ID. */ agentId: string; /** GET or HEAD. @default GET */ method?: string }): Promise<Response> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT * FROM attachments WHERE id=?", params: [opts.id] }) as any[];
    const row = rows[0];
    if (!row) return new Response("not found", { status: 404 });
    let visible = String(row.agent_id) === opts.agentId;
    if (!visible) {
        try {
            visible = (await ctx.fns.session.getFullMessages({ id: opts.agentId }))
                .some((m: any) => Array.isArray(m.content) && m.content.some((p: any) => p?.attachmentId === opts.id));
        } catch { return new Response("not found", { status: 404 }); }
    }
    if (!visible) {
        // A fork carries its parent's plan, and with it the files attached to the plan's tasks (session.attachToTask)
        // — also those no message shows yet.
        const holder = (ctx.state as any).agent?.[opts.agentId] ?? await ctx.fns.session.load({ id: opts.agentId }).catch(() => null);
        const tasks: any[] = Array.isArray(holder?.scratchpad?.plan?.tasks) ? holder.scratchpad.plan.tasks : [];
        visible = tasks.some(task => (Array.isArray(task?.attachments) ? task.attachments : []).some((file: any) => String(file?.attachmentId) === opts.id));
    }
    if (!visible) return new Response("not found", { status: 404 });
    const file = Bun.file(String(row.storage_path));
    if (!await file.exists()) return new Response("not found", { status: 404 });
    const inline = String(row.mime_type).startsWith("image/") || String(row.mime_type) === "application/pdf";
    const safe = String(row.original_name).replace(/[\r\n"\\/]/g, "_");
    return new Response(String(opts.method ?? "GET").toUpperCase() === "HEAD" ? null : file, { headers: {
        "content-type": String(row.mime_type), "content-length": String(row.size_bytes),
        "content-disposition": `${inline ? "inline" : "attachment"}; filename="${safe}"`,
        "cache-control": "private, max-age=3600", "x-content-type-options": "nosniff",
    } });
}
