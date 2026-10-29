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

    // Time comes from the `turn` events agent.run writes (one per answer, start then end). Each row takes the
    // nearest turn above it: an open turn ticks from its start on the live row, a closed one draws its whole time
    // after its last row (the one holding turn.lastToolIdx).
    const hasRows = continueRun.length > 0 || parts.some(p => p.kind === "tools") || !!opts.live;
    const firstIdx = Number(continueRun[0]?.idx ?? events.find(e => e?.idx != null)?.idx ?? Number.MAX_SAFE_INTEGER);
    const turnRows = hasRows ? ((await ctx.fns.procs.db.select({
        sql: "SELECT idx, payload FROM events WHERE agent_id = ? AND type = 'turn' AND idx < ? ORDER BY idx DESC LIMIT 2",
        params: [agentId, opts.live ? 2_147_483_647 : Math.min(firstIdx, 2_147_483_647)],
    })) as any[]).map(r => ({ ...(typeof r.payload === "string" ? JSON.parse(r.payload) : r.payload), idx: Number(r.idx) })) : [];
    const before = turnRows.find(t => t.idx < firstIdx);
    const running = opts.live
        && (!!(ctx.state as any).agent?.[agentId]?.isStreaming
            || ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents WHERE id = ? AND run_state = 'running'", params: [agentId] })) as any[]).length > 0);
    const since = (turn: any) => running && turn && !turn.endedAt && turn.durationMs == null ? Number(turn.startedAt) || undefined : undefined;
    const doneMs = (turn: any, run: any[]) => turn?.endedAt && run.some(e => Number(e?.idx) === Number(turn.lastToolIdx))
        ? Math.max(0, Number(turn.endedAt) - Number(turn.startedAt))
        : undefined;
    const rowTurn = new Map<number, any>();
    let cur = before;
    parts.forEach((part, i) => {
        if (part.kind === "event" && part.event?.type === "turn") cur = part.event;
        else if (part.kind === "tools") rowTurn.set(i, cur);
    });
    const latest = turnRows[0];

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
        ? ctx.fns.agent.renderToolRun({ agentId, events: continueRun, oob: true, running: !!opts.live && parts.length === 0, turnSince: since(before), elapsedMs: doneMs(before, continueRun) })
        : "";
    // The running call has no row to join when the transcript ends in something else (text, a note): it gets
    // a row of its own, id tools-live, which the next live render replaces.
    const endsInRun = parts.length ? parts[parts.length - 1]!.kind === "tools" : continueRun.length > 0;
    const liveRow = opts.live && !endsInRun ? ctx.fns.agent.renderToolRun({ agentId, events: [], running: true, turnSince: since(latest) }) : "";
    // A turn that just closed has its last row on screen already, outside this tail: redraw it with its time.
    const shown = new Set([...continueRun, ...events].map(e => Number(e?.idx)));
    const closed = turnRows.find(t => t.endedAt);
    const lastIdx = Number(closed?.lastToolIdx ?? -1);
    const finishedRow = opts.live && lastIdx >= 0 && !shown.has(lastIdx) && Date.now() - Number(closed.endedAt) < 120_000
        ? await (async () => {
            const run = await ctx.fns.agent.toolRunBefore({ agentId, beforeIdx: lastIdx + 1 });
            return run.length ? ctx.fns.agent.renderToolRun({ agentId, events: run, oob: true, elapsedMs: doneMs(closed, run) }) : "";
        })().catch(() => "")
        : "";
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
            const turn = first ? before : rowTurn.get(i);
            const row = ctx.fns.agent.renderToolRun({ agentId, events: run, running: last && !!opts.live, oob: first, turnSince: since(turn), elapsedMs: doneMs(turn, run) });
            const drop = last && joinRun.length && Number(joinRun[0].idx) !== Number(run[0].idx)
                ? `<div id="tools-${Number(joinRun[0].idx)}" hx-swap-oob="delete"></div>`
                : "";
            return row + drop;
        } catch (error: any) {
            return failed(part.events[0]?.idx, error);
        }
    }))).join("\n") + liveRow + finishedRow;
}
