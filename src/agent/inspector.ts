/**
 * Shows an agent's inspector — settings, automation, goal, knowledge, team and plan — as a page.
 *
 * The agent inspector as an addressable page (/rpc/agent.inspector?{"agentId":…}) instead of a fixed right column: opened as a canvas tab from the chat header's info button, or in a browser tab. Every section is the same server-rendered fragment as before (ui.agentMetaSectionHtml) with its htmx forms; the page re-fetches itself when events.refreshAgentMeta announces a change for this agent (topic agent-meta).
 * @view
 * @live agent-meta
 * @param opts.agentId Agent whose inspector to show.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose inspector to show. */
        agentId: string;
    },
): Promise<string> {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
        const id = String(opts.agentId ?? "");
        const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
        if (!agent) return ctx.fns.w.empty({ title: `No such agent: ${id}`, icon: "question" });
        const sections = ["settings", "automation", "goal", "knowledge", "team", "plan"] as const;
        // The same per-section renderer the inspector column used, so a section never drifts between places.
        const parts = await Promise.all(sections.map(section => ctx.fns.ui.agentMetaSectionHtml({ agentId: id, section }).catch((e: any) => ctx.fns.w.eventNote({ text: `${section}: ${e?.message ?? e}`, icon: "warning", tone: "danger" }))));
        const w = ctx.fns.w;
        const body = w.card({ flush: true, body: w.box({ body: parts.map((html, i) => `<div data-meta-section="${sections[i]}">${html}</div>`).join(""), mix: { layout: "stack", line: "between" } }) });
        return `<div data-agent-inspector="${esc(id)}">${w.page({ page: "agent-inspector", title: agent.title || id, lead: esc(id), body })}</div>`;
}
