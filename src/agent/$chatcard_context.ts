// Panel card: what the model sees — size of the last request, compaction and the full system prompt.
export default {
    title: "Context",
    icon: "ph-stack",
    order: 20,
    async render(ctx: Context, _session: Session | null, view: types.chat.RenderContext): Promise<types.chat.CardRow[]> {
        const last = ((await ctx.fns.procs.db.select({
            sql: "SELECT payload FROM events WHERE agent_id = ? AND type = 'assistant' ORDER BY idx DESC LIMIT 1",
            params: [view.agent.id],
        })) as any[])[0];
        let usage: any = null;
        try { usage = last ? JSON.parse(last.payload).usage ?? null : null; } catch { usage = null; }
        const tokens = usage ? Number(usage.prompt_tokens ?? 0) + Number(usage.completion_tokens ?? 0) : 0;
        const agentId = view.agent.id;
        return [
            { icon: "ph-gauge", label: "Last request", hint: tokens ? `${(tokens / 1000).toFixed(1)}k tokens` : "—" },
            { icon: "ph-arrows-in-line-vertical", label: "Compact context…", popup: { method: "chat.compactPopup", params: { agentId } } },
            { icon: "ph-scroll", label: "Initial prompt", popup: { method: "agent.initialPromptPopup", params: { agentId } } },
        ];
    },
} satisfies types.chat.Card;
