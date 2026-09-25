/** Replace events for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Events to persist or render. */
events: any[];
        /** Ts used by the operation. */
ts?: number }): Promise<{ count: number }> {
    const { id, events } = opts;
    const ts = opts.ts ?? Date.now();
    await ctx.fns.procs.db.run({ sql: 'DELETE FROM events WHERE agent_id = ?', params: [id] });
    for (let i = 0; i < events.length; i++) {
        const e: any = events[i];
        await ctx.fns.procs.db.run({ sql: 'INSERT INTO events (agent_id, idx, type, payload, ts, actor) VALUES (?, ?, ?, ?, ?, ?)', params: [id, i, e.type, JSON.stringify(e), ts, e.actor ?? null] });
    }
    await ctx.fns.procs.db.run({ sql: 'UPDATE agents SET updated_at = ? WHERE id = ?', params: [ts, id] });
    return { count: events.length };
}
