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
        if (!agent) return `<div class="p-6 text-sm text-faint">No such agent: ${esc(id)}</div>`;
        const sections = ["settings", "automation", "goal", "knowledge", "team", "plan"] as const;
        // The same per-section renderer the inspector column used, so a section never drifts between places.
        const parts = await Promise.all(sections.map(section => ctx.fns.ui.agentMetaSectionHtml({ agentId: id, section }).catch((e: any) => `<div class="px-3 py-2 text-3xs text-faint">${esc(section)}: ${esc(e?.message ?? e)}</div>`)));
        return `<div class="agent-inspector mx-auto w-full max-w-2xl px-4 py-5" data-agent-inspector="${esc(id)}">
      <h1 class="mb-3 flex items-center gap-2 text-sm font-semibold"><i class="ph ph-info text-faint" aria-hidden="true"></i><span class="min-w-0 flex-1 truncate">${esc(agent.title || id)}</span><span class="font-mono text-3xs font-normal text-faint">${esc(id)}</span></h1>
      <div class="divide-y divide-ui-border overflow-hidden rounded-xl border border-ui-border bg-base-100">${parts.map((html, i) => `<div data-meta-section="${sections[i]}">${html}</div>`).join("")}</div>
    </div>`;
}
