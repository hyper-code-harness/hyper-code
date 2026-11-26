/**
 * Show the delivered workspace instruction sources in agent settings
 *
 * Renders source paths, deduplication and truncation statuses from the last model-visible instruction snapshot. Does not read source files or expose their contents; switching workspace shows that the selection awaits the next request.
 * @param opts.agentId Agent whose last delivered workspace instruction provenance should be shown.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent whose last delivered workspace instruction provenance should be shown. */
        agentId: string;
    },
): Promise<string> {
    const agent = ctx.state.agent?.[opts.agentId] ?? await ctx.fns.session.load({id:opts.agentId});
    if (!agent) return '';
    const state = agent.scratchpad?.workspaceInstructions as types.workspaceInstructions.AgentInstructionsState | undefined;
    const esc = (text: string) => Bun.escapeHTML(text);
    const key = JSON.stringify([String(agent.workspaceHost ?? '').trim(), agent.workspaceDir || process.cwd()]);
    const heading = '<section><h4>Workspace instructions</h4>';
    if (!state || state.key !== key) return heading + '<p>AGENTS.md and CLAUDE.md will be checked before the next model request.</p></section>';
    const sources = state.sources ?? [];
    const rows = sources.map(source => '<li><code>' + esc(source.path) + '</code> — ' + esc(source.scope) + ', ' + esc(source.status) + ', ' + source.bytes + ' bytes' + (source.duplicateOf ? '; duplicate of <code>' + esc(source.duplicateOf) + '</code>' : '') + '</li>').join('');
    const warnings = (state.warnings ?? []).map(warning => '<li>' + esc(warning) + '</li>').join('');
    return heading + '<p>Project root: <code>' + esc(state.root ?? '') + '</code>. Content budget: 64 KiB each for global and project instructions.</p>' + (rows ? '<ul>' + rows + '</ul>' : '<p>No instruction files found.</p>') + (warnings ? '<p>Warnings:</p><ul>' + warnings + '</ul>' : '') + '</section>';
}
