/**
 * Persist a submitted chat turn with attachments and schedule its agent.
 *
 * Shared existing chat HTTP submission pipeline; callers must authenticate and resolve the durable agent before calling.
 * @param opts.req Text or multipart chat request.
 * @param opts.params Route values containing the existing agent id.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Text or multipart chat request. */
        req: Request;
        /** Route values containing the existing agent id. */
        params: Record<string, string>;
    },
): Promise<Response> {
    const req = opts.req;
        const id = opts.params.id!;
        let agent = (ctx.state as any).agent?.[id];
        if (!agent) {
            agent = (await ctx.fns.session.load({ id })) ?? null;
            if (agent) { (ctx.state as any).agent ??= {}; (ctx.state as any).agent[id] = agent; }
        }
        if (!agent) return Response.json({ error: "not found" }, { status: 404 });

        let text = "";
        let files: File[] = [];
        const ct = String(req.headers.get("content-type") ?? "");
        if (ct.startsWith("multipart/form-data") || ct.startsWith("application/x-www-form-urlencoded")) {
            const form = await req.formData();
            if (form.has("text")) text = typeof form.get("text") === "string" ? String(form.get("text")).trim() : "";
            else {
                const lines: string[] = [];
                for (const [name, value] of form.entries()) if (typeof value === "string") lines.push(`${name}: ${value}`);
                text = lines.join("\n").trim();
            }
            files = [...form.getAll("files"), ...form.getAll("file")].filter(value => value instanceof File && value.size > 0) as File[];
        } else text = (await req.text()).trim();
        if (!text && files.length === 0) return Response.json({ error: "empty input" }, { status: 400 });

        let uploads: Awaited<ReturnType<typeof ctx.fns.attachments.saveUploads>> = [];
        try { uploads = await ctx.fns.attachments.saveUploads({ agentId: id, files }); }
        catch (error: any) { return Response.json({ error: String(error?.message ?? error) }, { status: 400 }); }

        const content: types.tools.Content[] = [];
        if (text) content.push({ type: "text", text });
        content.push(...uploads.map(item => item.ref));
        const ts = Date.now();
        const userAppend = await ctx.fns.session.appendMessage({ id, message: { role: "user", content: uploads.length ? content : text }, ts });
        if (uploads.length) await ctx.fns.attachments.commitUploads({ agentId: id, messageIdx: userAppend.idx, uploads });
        const event: any = { type: "user", text, attachments: uploads.map(item => item.meta), messageIdx: userAppend.idx, ts };
        event.html = await ctx.fns.agent.renderEventHtml({ event, agentId: id });
        await ctx.fns.session.appendEvent({ id, event, ts });
        await ctx.fns.session.syncAgentState({ agent });

        // Instant steering cancels only the active provider request. The durable
        // run and worker lease continue; agent.run refreshes history and samples
        // again. Tool execution has no sampling controller, so tools finish at
        // their safe boundary before the new input is consumed.
        if (agent.isStreaming && agent.samplingAbortController && !agent.samplingAbortController.signal.aborted) {
            try { agent.samplingAbortController.abort("new_user_input"); } catch {}
        }
    
        // Display-only observer: it runs independently and never changes the
        // execution goal, queue cursor, or transcript of this agent.
        if (text && agent.scratchpad?.goalTrackingEnabled === true && ctx.fns.agent.updateGoalSidecar) void ctx.fns.agent.updateGoalSidecar({ agent, messageIdx: userAppend.idx, userMessage: text }).catch(() => undefined);
        const url = new URL(req.url);
        const explicitSeconds = url.searchParams.get("debounceSeconds");
        const perAgent = await ctx.fns.settings.getNumber({ module: "ui", scopeType: "agent", scopeId: id, key: "debounceMs" });
        const declared = await ctx.fns.settings.getNumber({ module: "agent", scopeType: "global", key: "debounceMs" });
        const debounceMs = explicitSeconds != null ? Math.max(0, Number(explicitSeconds) * 1000) : (perAgent ?? declared ?? 5000);
        const sendAt = Date.now() + debounceMs;
        await ctx.fns.procs.db.run({ sql: `UPDATE agents SET next_run_at=GREATEST(COALESCE(next_run_at,0),?), updated_at=? WHERE id=?`, params: [sendAt, Date.now(), id] });
        ctx.fns.agent.wakeWorker({});

        if (req.headers.get("hx-request") === "true") return new Response(null, { status: 204 });
        if (String(req.headers.get("accept") ?? "").includes("text/html")) return new Response(null, { status: 303, headers: { location: `/agent/${encodeURIComponent(id)}` } });
        return Response.json({ ok: true, sendAt, messageIdx: userAppend.idx, attachments: uploads.map(item => item.meta) });
}
