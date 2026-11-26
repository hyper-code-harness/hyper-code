/** Show the agent's last loaded AGENTS.md and CLAUDE.md sources in inspector settings.
 * @param opts.agentId Agent whose instruction provenance is displayed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose last model-visible instruction sources should be displayed. */
    agentId: string;
}): Promise<string> {
    return ctx.fns.workspaceInstructions.settingsHtml({agentId: opts.agentId});
}
