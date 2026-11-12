/** Replaces one persisted event payload by event index. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
        id: string;
        /** Event index to replace. */
        idx: number;
        /** Complete replacement event. */
        event: any;
    },
): Promise<{ updated: boolean }> {
    const result = await ctx.fns.procs.db.run({
        sql: "UPDATE events SET type=?, payload=?::jsonb WHERE agent_id=? AND idx=?",
        params: [opts.event.type, JSON.stringify(opts.event), opts.id, opts.idx],
    });
    await ctx.fns.session.markChanged({ id: opts.id, events: opts.idx });
    return { updated: result.changes > 0 };
}
