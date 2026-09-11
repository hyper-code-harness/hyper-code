/** Returns a bounded transcript event page for the native mobile chat. */
export default async function (ctx: Context, _session: Session | null, opts: { req: Request; params: Record<string, string> }) {
    const id = opts.params.id!;
    const exists = ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ?", params: [id] })) as any[])[0];
    if (!exists) return Response.json({ error: "not_found", message: "Agent not found" }, { status: 404 });

    const url = new URL(opts.req.url);
    const afterRaw = url.searchParams.get("after");
    const beforeRaw = url.searchParams.get("before");
    const limit = Math.min(200, Math.max(1, Number(url.searchParams.get("limit") ?? 80) || 80));
    const maxIdx = await ctx.fns.session.getMaxEventIdx({ id });
    // Initial chat load is a backwards page ending at the current tail. Asking
    // getEvents from index zero with a limit returns the *oldest* page, which
    // made a newly opened native chat look reversed/stale and then advanced its
    // polling cursor past the unseen middle. Explicit `after` remains the live
    // incremental path; explicit `before` remains older-history pagination.
    const events = beforeRaw != null
        ? await ctx.fns.session.getEvents({ id, beforeIdx: Math.max(0, Number(beforeRaw) || 0), limit })
        : afterRaw != null
            ? await ctx.fns.session.getEvents({ id, fromIdx: Math.max(0, Number(afterRaw) || 0), limit })
            : await ctx.fns.session.getEvents({ id, beforeIdx: maxIdx + 1, limit });
    const status = ((await ctx.fns.procs.db.select({ sql: "SELECT run_state, next_run_at, last_error FROM agents WHERE id = ?", params: [id] })) as any[])[0];
    const isRunning = status?.run_state === "running" || status?.run_state === "claimed" || status?.next_run_at != null;

    const toolPreview = (name: string, args: any): string => {
        const value = args && typeof args === "object" ? args : {};
        const first = (...keys: string[]) => keys.map((key) => value[key]).find((item) => typeof item === "string" && item.length > 0);
        const basename = (path: string) => path.replace(/\\/g, "/").split("/").filter(Boolean).pop() || path;
        switch (name) {
            case "read": return `Read ${basename(first("path", "file") || "file")}`;
            case "write": return `Write ${basename(first("path", "file") || "file")}`;
            case "edit": return `Edit ${basename(first("path", "file") || "file")}`;
            case "grep": return `Search ${first("pattern", "query") || "files"}`;
            case "find": return `Find ${first("pattern", "query") || "files"}`;
            case "bash": return `Run ${first("command")?.split("\n")[0] || "command"}`;
            case "eval": return `Evaluate ${first("code")?.split("\n")[0] || "code"}`;
            default: {
                const subject = first("path", "file", "query", "name", "id", "url");
                return subject ? `${name} ${subject}` : name;
            }
        }
    };

    const mobileEvents = events
        .filter((event: any) => ["user", "assistant", "error", "tool_call", "tool_result", "stop"].includes(String(event.type)))
        .map((event: any) => ({
            idx: Number(event.idx),
            ts: Number(event.ts),
            type: String(event.type),
            text: typeof event.text === "string" ? event.text : (typeof event.error === "string" ? event.error : null),
            name: typeof event.name === "string" ? event.name : null,
            preview: event.type === "tool_call"
                ? toolPreview(String(event.name || "Tool"), event.args)
                : (typeof event.text === "string" ? event.text.slice(0, 180) : null),
            isError: event.isError === true,
            attachments: Array.isArray(event.attachments) ? event.attachments.map((attachment: any) => ({
                id: attachment.id == null ? null : String(attachment.id),
                name: attachment.name ?? attachment.fileName ?? null,
                contentType: attachment.contentType ?? attachment.mimeType ?? null,
                size: attachment.size == null ? null : Number(attachment.size),
            })) : [],
        }));

    const liveAgent = (ctx.state as any).agent?.[id];
    const stream = liveAgent?.scratchpad?.mobileStream;
    const partial = isRunning && typeof stream?.text === "string" && stream.text.length > 0
        ? { text: stream.text, revision: Number(stream.revision ?? 0), startedAt: Number(stream.startedAt ?? Date.now()) }
        : null;

    return Response.json({
        version: 1,
        agentId: id,
        events: mobileEvents,
        nextAfter: maxIdx + 1,
        olderBefore: events.length > 0 ? Number(events[0]?.idx ?? 0) : null,
        hasOlder: events.length > 0 && Number(events[0]?.idx ?? 0) > 0,
        isRunning,
        runState: status?.run_state || "idle",
        lastError: status?.last_error || null,
        partial,
    });
}
