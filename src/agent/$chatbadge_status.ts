// Chat header badge: run state (idle, running 12s, error, parked) and context size — a live region that the
// agent's event stream refreshes.
export default {
    order: 30,
    async render(ctx: Context, _session: Session | null, view: types.chat.RenderContext): Promise<string> {
        const last = ((await ctx.fns.procs.db.select({
            sql: "SELECT payload FROM events WHERE agent_id = ? AND type = 'assistant' ORDER BY idx DESC LIMIT 1",
            params: [view.agent.id],
        })) as any[])[0];
        let usage: any = null;
        try { usage = last ? JSON.parse(last.payload).usage ?? null : null; } catch { usage = null; }
        return await ctx.fns.agent.renderStatusBar({ agentId: view.agent.id, initialUsage: usage });
    },
} satisfies types.chat.Badge;
