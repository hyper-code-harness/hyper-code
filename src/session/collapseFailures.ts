// Collapse corrected failures out of the LLM's view (co's design, refined):
// flag the message rows excluded_from_llm=1 — getMessages drops them from the
// effective transcript — and stamp the matching UI events excludedFromLlm so
// the chat can show "out of context". Nothing is deleted: events/messages stay
// as the audit history. Near-tail edits are prefix-cache-cheap.
/** Collapse failures for the runtime. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent identifier. */
    id: string;
        /** Message idxs used by the operation. */
    messageIdxs: number[] },
): Promise<{ collapsed: number }> {
    const idxs = [...new Set(opts.messageIdxs)].filter((n) => Number.isInteger(n) && n >= 0);
    if (idxs.length === 0) return { collapsed: 0 };
    await ctx.fns.procs.db.run({
        sql: `UPDATE messages SET excluded_from_llm = 1 WHERE agent_id = ? AND idx IN (${idxs.map(() => '?').join(',')})`,
        params: [opts.id, ...idxs],
    });
    await ctx.fns.session.markChanged({ id: opts.id, messages: Math.min(...idxs) });
    const events = (await ctx.fns.procs.db.select({
        sql: 'SELECT idx, payload FROM events WHERE agent_id = ?',
        params: [opts.id],
    })) as any[];
    for (const e of events) {
        try {
            const p = JSON.parse(e.payload);
            if (p.messageIdx != null && idxs.includes(Number(p.messageIdx)) && !p.excludedFromLlm) {
                p.excludedFromLlm = true;
                await ctx.fns.procs.db.run({
                    sql: 'UPDATE events SET payload = ? WHERE agent_id = ? AND idx = ?',
                    params: [JSON.stringify(p), opts.id, e.idx],
                });
                await ctx.fns.session.markChanged({ id: opts.id, events: Number(e.idx) });
            }
        } catch { /* unparseable payload — leave it */ }
    }
    return { collapsed: idxs.length };
}
