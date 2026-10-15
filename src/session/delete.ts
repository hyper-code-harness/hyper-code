/** Delete a leaf agent's persisted transcript. Refuse parents with dependent forks, including archived children, to preserve inherited history and result references. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string }): Promise<{ ok: boolean }> {
    const { id } = opts;
    const children = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE parent_id = ? LIMIT 1", params: [id] });
    if (children.length) throw new Error(`Cannot delete agent ${id}: dependent forks still inherit its history. Archive it instead, or detach/materialize its forks first.`);
    const res = await ctx.fns.procs.db.run({ sql: "DELETE FROM agents WHERE id = ?", params: [id] });
    const removed = res.changes > 0;
    if (removed) {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM messages WHERE agent_id = ?", params: [id] });
        await ctx.fns.procs.db.run({ sql: "DELETE FROM events WHERE agent_id = ?", params: [id] });
        await ctx.fns.events.emitAgentsChanged({ agentId: id, reason: "delete" });
        await ctx.fns.attachments.gc({});
    }
    return { ok: removed };
}
