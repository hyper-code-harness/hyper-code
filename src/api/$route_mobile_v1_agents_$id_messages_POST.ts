/** Appends a native mobile user message with optional photo/file attachments and schedules the agent. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const id = opts.params.id!;
    let agent = (ctx.state as any).agent?.[id];
    if (!agent) { agent = await ctx.fns.session.load({ id }); if (agent) { (ctx.state as any).agent ??= {}; (ctx.state as any).agent[id] = agent; } }
    if (!agent) return Response.json({ error: "not_found", message: "Agent not found" }, { status: 404 });

    const contentType = opts.req.headers.get("content-type") ?? "";
    let text = "", debounceMs = 100;
    let files: File[] = [];
    if (contentType.startsWith("multipart/form-data")) {
        const form = await opts.req.formData();
        text = String(form.get("text") ?? "").trim();
        debounceMs = Number(form.get("debounceMs") ?? 100) || 0;
        files = form.getAll("files").flatMap(value => {
            const file = value as File;
            return typeof file?.arrayBuffer === "function" && Number(file.size) > 0 ? [file] : [];
        });
    } else {
        let body: any;
        try { body = await opts.req.json(); } catch { return Response.json({ error: "invalid_json", message: "Expected JSON or multipart form data" }, { status: 400 }); }
        text = typeof body?.text === "string" ? body.text.trim() : "";
        debounceMs = Number(body?.debounceMs ?? 100) || 0;
    }
    if (!text && files.length === 0) return Response.json({ error: "empty_message", message: "Message text or an attachment is required" }, { status: 400 });
    if (text.length > 200_000) return Response.json({ error: "message_too_large", message: "Message is too large" }, { status: 413 });
    if (files.length > 10) return Response.json({ error: "too_many_files", message: "At most 10 attachments are allowed" }, { status: 413 });
    if (files.some(file => file.size > 25 * 1024 * 1024)) return Response.json({ error: "file_too_large", message: "Each attachment must be at most 25 MB" }, { status: 413 });

    let uploads: Awaited<ReturnType<typeof ctx.fns.attachments.saveUploads>> = [];
    try { uploads = await ctx.fns.attachments.saveUploads({ agentId: id, files }); }
    catch (error: any) { return Response.json({ error: "attachment_failed", message: String(error?.message ?? error) }, { status: 400 }); }
    const content: types.tools.Content[] = [];
    if (text) content.push({ type: "text", text });
    content.push(...uploads.map(upload => upload.ref));
    const ts = Date.now();
    const appended = await ctx.fns.session.appendMessage({ id, message: { role: "user", content: uploads.length ? content : text }, ts });
    if (uploads.length) await ctx.fns.attachments.commitUploads({ agentId: id, messageIdx: appended.idx, uploads });
    const event: any = { type: "user", text, attachments: uploads.map(upload => upload.meta), messageIdx: appended.idx, ts };
    event.actor = await ctx.fns.auth.actorId({ agentId: id }) ?? undefined;
    event.html = await ctx.fns.agent.renderEventHtml({ event, agentId: id });
    const eventIdx = await ctx.fns.session.appendEvent({ id, event, ts });
    await ctx.fns.session.syncAgentState({ agent });


    // Keep goal observation off the critical response path and separate from
    // the main agent's execution state.
    if (text && agent.scratchpad?.goalTrackingEnabled === true && ctx.fns.agent.updateGoalSidecar) void ctx.fns.agent.updateGoalSidecar({ agent, messageIdx: appended.idx, userMessage: text }).catch(() => undefined);
    const sendAt = Date.now() + Math.min(30_000, Math.max(0, debounceMs));
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at=GREATEST(COALESCE(next_run_at,0),?), updated_at=? WHERE id=?", params: [sendAt, Date.now(), id] });
    ctx.fns.agent.wakeWorker({});
    return Response.json({ version: 1, ok: true, messageIdx: appended.idx, eventIdx: eventIdx.idx, sendAt, attachments: uploads.map(upload => upload.meta) }, { status: 202 });
}
