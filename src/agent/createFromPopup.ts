/**
 * Handles popup form submission for creating an agent and, when needed, asks to create its workspace.
 * @param opts.title Human-readable agent title.
 * @param opts.workspaceDir Workspace directory assigned to the agent.
 * @param opts.createWorkspaceDir Whether to create a missing workspace directory (`"1"` to enable).
 * @param opts.model Model identifier to use.
 * @param opts.promptPreset System-prompt preset name or names.
 * @param opts.systemPrompt Additional system instructions.
 */
export default async function (ctx: Context, _session: Session | null, opts: any): Promise<Response> {
    const result = await ctx.fns.agent.createFromValues(opts);
    if (result.error) return new Response(result.error, { status: 400 });
    if (result.confirmation) {
        const esc = (v: any) => ctx.fns.procs.ui.escape({ text: v });
        const hidden = Object.entries(result.confirmation.values).flatMap(([name, value]: any) => (Array.isArray(value) ? value : [value]).map(value => `<input type="hidden" name="${esc(name)}" value="${esc(value)}">`)).join('');
        return new Response(ctx.fns.ui.popupContent({ title: 'Create workspace', kind: 'new-agent', html: `<p class="text-sm text-muted">Create <code>${esc(result.confirmation.dir)}</code>?</p><form hx-popup="agent.createFromPopup" title="Create workspace">${hidden}<input type="hidden" name="createWorkspaceDir" value="1">${ctx.fns.procs.ui.button({ action: 'create-directory-agent', label: 'Create directory and agent', type: 'submit', tone: 'primary', class: 'mt-4' })}</form>` }), { headers: { 'content-type': 'text/html' } });
    }
    return new Response('', { status: 204, headers: { 'HX-Redirect': `/agent/${encodeURIComponent(result.agent.id)}` } });
}
