// The RPC entry point for a pushed section redraw. The server emits
// ui.metaSection (events.refreshAgentMeta); the client answers with
// POST /rpc { method: "ui.agentMetaSectionHtml", params: { agentId, section } }
// and swaps the returned fragment into the section's slot.
/** Returns freshly rendered HTML for one agent inspector section. */
/**
 * Render one agent meta panel section for an RPC redraw.
 *
 * Loads the agent and only the data the requested section needs — team lists
 * for "team", models and accounts for a parked agent's wake section, nothing
 * otherwise. Returns the fragment, or an empty string when the section is not
 * on the page (e.g. the plan was just deleted).
 *
 * @param opts.agentId Agent whose section is rendered.
 * @param opts.section Section to render: goal, knowledge, automation, wake, team or plan.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose section is rendered. */
    agentId: string;
    /** Section to render. */
    section: "goal" | "knowledge" | "automation" | "schedules" | "wake" | "team" | "plan";
}): Promise<string> {
    const agentId = String(opts.agentId ?? "");
    const section = String(opts.section ?? "");
    if (!agentId) throw new Error("agentMetaSectionHtml: agentId is required");
    const agent = (ctx.state as any).agent?.[agentId] ?? await ctx.fns.session.load({ id: agentId });
    if (!agent) throw new Error(`agentMetaSectionHtml: agent not found: ${agentId}`);

    let team: any[] = [];
    let archivedTeam: any[] = [];
    let models: Record<string, string[]> = {};
    let accounts: any[] = [];
    let schedules: any[] = [];
    if (section === "team") {
        [team, archivedTeam] = await Promise.all([
            ctx.fns.agent.team({ agent }),
            ctx.fns.agent.team({ agent, includeArchived: true }),
        ]);
    } else if (section === "schedules") {
        schedules = await ctx.fns.agent.listSchedules({ agentId });
    } else if (section === "wake") {
        // Models and accounts only matter for a parked agent's switcher;
        // skipping them for everyone else keeps this redraw cheap.
        if (agent.scratchpad?.parked) {
            [models, accounts] = await Promise.all([
                ctx.fns.llm.listModels({}).catch(() => ({})),
                ctx.fns.llm.listAccounts({}).catch(() => []),
            ]);
        }
    }
    return ctx.fns.ui.agentMetaSection({ agent, section: section as any, team, archivedTeam, models, accounts, schedules });
}
