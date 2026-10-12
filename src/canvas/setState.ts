/**
 * Merges keys into a canvas tab's own state (scroll, selection, edits…), kept across reloads.
 *
 * Use from a kind's UI or from the agent to remember what the tab is showing; the agent sees the state in
 * its canvas block next turn. A key set to null is removed.
 * @param opts.itemId Tab whose state to change.
 * @param opts.state Keys to merge; null removes a key.
 * @param opts.agentId Agent whose canvas it is. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Tab whose state to change. */
    itemId: number;
    /** Keys to merge; null removes a key. */
    state: Record<string, any>;
    /** Agent whose canvas it is. @default the current agent */
    agentId?: string;
}): Promise<types.canvas.Item> {
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    // Read-merge-write under the agent's canvas lock, so two patches never drop each other's keys.
    return (await ctx.fns.canvas.locked({
        agentId,
        fn: async () => {
            const item = (await ctx.fns.canvas.list({ agentId })).find(i => i.id === Number(opts.itemId));
            if (!item) throw new Error(`canvas.setState: no tab ${opts.itemId} on ${agentId}'s canvas`);
            const next: Record<string, any> = { ...item.state };
            for (const [k, v] of Object.entries(opts.state ?? {})) { if (v === null) delete next[k]; else next[k] = v; }
            const text = JSON.stringify(next);
            if (text.length > 64_000) throw new Error("canvas.setState: state is limited to 64 KB — keep large content in files");
            await ctx.fns.procs.db.run({ sql: "UPDATE canvas_items SET state = ?::jsonb, updated_at = ? WHERE id = ? AND agent_id = ?", params: [text, Date.now(), item.id, agentId] });
            return { ...item, state: next };
        },
    })) as types.canvas.Item;
}
