/** Append event for the runtime. */
export default async function (ctx: Context, session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Event to persist or render. */
event: any;
        /** Ts used by the operation. */
ts?: number }): Promise<{ idx: number }> {
    const { id, event } = opts;
    const ts = opts.ts ?? Date.now();
    // Who caused this event. Kept in the payload too, so full rewrites (session.save,
    // replaceEvents) preserve it and the UI can show it without a join.
    if (event.actor === undefined) {
        const actor = await ctx.fns.auth.actorId({ agentId: id });
        if (actor) event.actor = actor;
    }
    // idx is allocated IN the insert (one statement, RETURNING) and retried on
    // a duplicate: a separate SELECT MAX + INSERT lost the race whenever two
    // appends overlapped — the stop button's error event against the running
    // turn's tool events was the reproducer.
    const payload = JSON.stringify(event).replaceAll('\u0000', '\uFFFD');
    let idx = -1;
    for (let attempt = 0; ; attempt++) {
        try {
            const res = await ctx.fns.procs.db.run({
                sql: `INSERT INTO events (agent_id, idx, type, payload, ts, actor)
                      SELECT ?, COALESCE(MAX(idx), -1) + 1, ?, ?, ?, ? FROM events WHERE agent_id = ?
                      RETURNING idx`,
                params: [id, event.type, payload, ts, event.actor ?? null, id],
            });
            idx = Number((res.rows as any[])?.[0]?.idx ?? -1);
            break;
        } catch (e: any) {
            if (attempt >= 9 || !/duplicate key|events_pkey/i.test(String(e?.message ?? e))) throw e;
            // Jittered backoff: a simultaneous burst all reads the same MAX —
            // without a pause the retries collide in lockstep too.
            await new Promise(r => setTimeout(r, 3 + Math.random() * 20 * (attempt + 1)));
        }
    }
    await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET updated_at = ? WHERE id = ?', params: [ts, id] });
    // Wake any in-process waiters AND broadcast over SSE so browser tabs
    // showing this agent fetch the delta with a short hx-get instead of
    // holding a long-poll connection per tab.
    await ctx.fns.agent?.wakeWaiters?.({ agentId: id });
    // Topic-addressed: a tab watching another agent is not woken, and the seq
    // this returns is the cursor a live region compares itself against.
    ctx.fns.procs.events.refresh({ topic: `agent:${id}`, reason: "event" });
    return { idx };
}
