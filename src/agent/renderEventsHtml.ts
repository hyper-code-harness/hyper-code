/**
 * Renders transcript events as chat HTML, drawing each run of consecutive tool calls as one w.toolGroup row.
 * @param opts.events Agent events to render, oldest first.
 * @param opts.agentId Target agent identifier.
 * @param opts.continueRun Tool calls already on screen right before these events (agent.toolRunBefore): a run at the start of `events` joins them and replaces their row out of band.
 * @param opts.joinRun Tool calls already on screen right after these events: a run at the end of `events` absorbs them, and their old row is deleted out of band.
 * @param opts.live These events end the transcript: the last run gets the agent's running call. @default false
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent events to render, oldest first. */
        events: any[];
        /** Agent id used by the operation. */
        agentId: string;
        /** Tool calls already on screen right before these events (agent.toolRunBefore): a run at the start of `events` joins them and replaces their row out of band. */
        continueRun?: any[];
        /** Tool calls already on screen right after these events: a run at the end of `events` absorbs them, and their old row is deleted out of band. */
        joinRun?: any[];
        /** These events end the transcript: the last run gets the agent's running call. @default false */
        live?: boolean;
    },
): Promise<string> {
    const { events, agentId } = opts;
    // The turn in progress: its start feeds the live row's overall clock and its thinking cell.
    // Read from the agents row (run_started_at, set by the worker's claim) — the durable source, right after a reload too.
    const turnSince = opts.live
        ? Number(((await ctx.fns.procs.db.select({ sql: "SELECT run_started_at FROM agents WHERE id = ? AND run_state = 'running'", params: [agentId] })) as any[])[0]?.run_started_at ?? 0) || undefined
        : undefined;
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });

    // A run of tool calls is one row drawn on the server: consecutive tool_call events (a job event draws
    // nothing, so it does not break a run) become one w.toolGroup.
    type Part = { kind: "tools"; events: any[] } | { kind: "event"; event: any };
    const parts: Part[] = [];
    for (const event of events) {
        if (event?.type === "job") continue;
        const last = parts[parts.length - 1];
        if (event?.type === "tool_call") {
            if (last?.kind === "tools") last.events.push(event);
            else parts.push({ kind: "tools", events: [event] });
        } else parts.push({ kind: "event", event });
    }
    const continueRun = opts.continueRun ?? [];
    const joinRun = opts.joinRun ?? [];

    // Always render, never serve a cached bubble: an event is data, and the
    // markup is a view of it that may change between two page loads (a tool
    // card ages, a renderer improves). Rendering a full transcript is ~7 ms.
    // One event may not take the transcript with it. The renderer is edited on
    // a live server — a half-landed refactor (a card calling a helper that
    // arrives a minute later), a row written before some validation existed —
    // and without isolation any of those turns every page of that agent into a
    // 500, which reads as "the app is down" rather than "one bubble is broken".
    const failed = (idx: unknown, error: any) => {
        const message = String(error?.message ?? error);
        ctx.fns.procs.log.warn({ event: "renderEvent.failed", msg: `${agentId}#${idx}: ${message}` });
        return `<div class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-2xs text-error">`
            + `this message could not be rendered (#${esc(idx ?? "?")})`
            + `<div class="mt-0.5 font-mono text-error/80">${esc(message)}</div></div>`;
    };
    // The run on screen before these events is over (they start with something else): redraw it without the
    // running call it may still show.
    // With no new events at all it is still the last run, and the running call (started or ended) is redrawn in it.
    const closePrev = continueRun.length && parts[0]?.kind !== "tools"
        ? ctx.fns.agent.renderToolRun({ agentId, events: continueRun, oob: true, running: !!opts.live && parts.length === 0, turnSince })
        : "";
    // The running call has no row to join when the transcript ends in something else (text, a note): it gets
    // a row of its own, id tools-live, which the next live render replaces.
    const endsInRun = parts.length ? parts[parts.length - 1]!.kind === "tools" : continueRun.length > 0;
    const liveRow = opts.live && !endsInRun ? ctx.fns.agent.renderToolRun({ agentId, events: [], running: true, turnSince }) : "";
    return closePrev + (await Promise.all(parts.map(async (part, i) => {
        if (part.kind === "event") {
            try {
                return await ctx.fns.agent.renderEventHtml({ event: part.event, agentId });
            } catch (error: any) {
                return failed(part.event?.idx, error);
            }
        }
        try {
            const first = i === 0 && continueRun.length > 0;
            const last = i === parts.length - 1;
            const run = [...(first ? continueRun : []), ...part.events, ...(last ? joinRun : [])];
            const row = ctx.fns.agent.renderToolRun({ agentId, events: run, running: last && !!opts.live, oob: first, turnSince });
            const drop = last && joinRun.length && Number(joinRun[0].idx) !== Number(run[0].idx)
                ? `<div id="tools-${Number(joinRun[0].idx)}" hx-swap-oob="delete"></div>`
                : "";
            return row + drop;
        } catch (error: any) {
            return failed(part.events[0]?.idx, error);
        }
    }))).join("\n") + liveRow;
}
