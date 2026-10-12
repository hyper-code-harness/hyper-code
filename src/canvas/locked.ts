/**
 * Runs a canvas change for one agent in a transaction holding that agent's canvas row lock.
 *
 * Every mutation of canvas_state or canvas_items goes through here, so concurrent opens, switches, closes and
 * width saves from several pages and the agent apply one after another on fresh data. Emits canvas.changed
 * after commit.
 * @param opts.agentId Agent whose canvas to lock.
 * @param opts.fn The change; runs inside the transaction, must await all its database work.
 */
export default async function <T>(ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas to lock. */
    agentId: string;
    /** The change; runs inside the transaction, must await all its database work. */
    fn: () => Promise<T>;
}): Promise<T> {
    const result = await ctx.fns.procs.db.transaction({
        fn: async () => {
            await ctx.fns.procs.db.run({ sql: "INSERT INTO canvas_state (agent_id, open, updated_at) VALUES (?, false, ?) ON CONFLICT (agent_id) DO NOTHING", params: [opts.agentId, Date.now()] });
            await ctx.fns.procs.db.select({ sql: "SELECT agent_id FROM canvas_state WHERE agent_id = ? FOR UPDATE", params: [opts.agentId] });
            return await opts.fn();
        },
    });
    await ctx.fns.canvas.notify({ agentId: opts.agentId });
    return result as T;
}
