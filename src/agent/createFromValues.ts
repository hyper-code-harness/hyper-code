import { resolve } from 'node:path';

/** Create an agent from form values after workspace and prompt validation.
 * Preview an explicit shared Claude account without writes, and apply it only after agent creation succeeds. If that final selection fails, return both the created agent and an explicit error; no inference is scheduled.
 * @param opts.title Human-readable agent title.
 * @param opts.workspaceDir Workspace directory assigned to the agent; empty inside a project means the project's folder.
 * @param opts.createWorkspaceDir Whether to create a missing workspace directory.
 * @param opts.claudeAccount Explicit managed Claude account chosen after the model; changes the shared current account only when this form is submitted.
 * @param opts.model Model identifier to use.
 * @param opts.promptPreset System-prompt preset name.
 * @param opts.systemPrompt Additional system instructions.
 * @param opts.systemPromptName Name of the base system prompt (agent.systemPrompts); remembered as the person's last pick.
 * @param opts.systemPromptCore A one-off base system prompt text used instead of a named one.
 * @param opts.saveSystemPromptAs With own text (systemPromptName __custom): save it under this name and use the name.
 * @param opts.projectId Project id to attach the agent to; empty for none.
*/
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Human-readable title. */
title?: string;
        /** Workspace dir used by the operation. */
workspaceDir?: string;
        /** Create workspace dir used by the operation. */
createWorkspaceDir?: string;
        /** Model identifier. */
model?: string;
        /** Explicit managed Claude account to make current for local chats and incoming relay when submitting this form. */
claudeAccount?: string;
        /** Prompt preset used by the operation. */
promptPreset?: string | string[];
        /** Additional system instructions. */
systemPrompt?: string;
        /** Name of the base system prompt; remembered as the person's last pick. */
systemPromptName?: string;
        /** A one-off base system prompt text used instead of a named one. */
systemPromptCore?: string;
        /** With own text (systemPromptName __custom): save it under this name and use the name. */
saveSystemPromptAs?: string;
        /** Project id to attach the agent to; empty for none. */
projectId?: string }): Promise<{ agent?: any; confirmation?: { dir: string; values: Record<string, any> }; error?: string }> {
    const requestedWorkspace = String(opts.workspaceDir ?? '');
    const projectId = String(opts.projectId ?? '').trim() || null;
    try {
        // Inside a project an empty folder means the project's own (dir and host) — agent.start fills it in.
        const workspaceDir = projectId && !requestedWorkspace.trim() ? undefined : await ctx.fns.workspace.normalize({ dir: requestedWorkspace, create: opts.createWorkspaceDir === '1' });
        let model = String(opts.model ?? '').trim() || (await ctx.fns.settings.modelDefault({})) || ctx.env.MODEL || 'claude-code:claude-opus-5';
        const presets = await ctx.fns.agent.listPromptPresets({});
        const ids = (Array.isArray(opts.promptPreset) ? opts.promptPreset : opts.promptPreset ? [opts.promptPreset] : []) as (keyof typeof presets)[];
        const presetText = ids.filter(id => Object.prototype.hasOwnProperty.call(presets, id)).map(id => presets[id].text.trim()).filter(Boolean).join('\n\n');
        const systemPrompt = [presetText, String(opts.systemPrompt ?? '').trim()].filter(Boolean).join('\n\n');
        let systemPromptName = String(opts.systemPromptName ?? '').trim();
        let systemPromptCore = String(opts.systemPromptCore ?? '');
        // "Write your own…" in the form: a one-off base, or saved under a name and then used by that name.
        if (systemPromptName === '__custom') {
            systemPromptName = '';
            if (!systemPromptCore.trim()) return { error: 'Own system prompt is empty' };
            const saveAs = String(opts.saveSystemPromptAs ?? '').trim();
            if (saveAs) {
                const saved = await ctx.fns.agent.saveSystemPrompt({ name: saveAs, text: systemPromptCore, userId: await ctx.fns.auth.actorId({}) });
                systemPromptName = saved.name;
                systemPromptCore = '';
            }
        } else if (systemPromptName) systemPromptCore = ''; // a name picked in the form wins over text left in its hidden editor
        if (systemPromptName && !systemPromptCore.trim()) {
            const project = projectId ? (await ctx.fns.project.get({ id: projectId })) ?? (await ctx.fns.project.get({ slug: projectId })) : null;
            const known = await ctx.fns.agent.systemPrompts({ userId: await ctx.fns.auth.actorId({}), projectId: project?.id ?? null, name: systemPromptName });
            if (!known.length) return { error: `Unknown system prompt: ${systemPromptName}` };
        }
        const claude = /^(?:claude-code|anthropic-oauth)(?:\/[^:]+)?:(.+)$/.exec(model);
        if (opts.claudeAccount && !claude) return { error: 'A Claude subscription model is required to select a shared Claude account' };
        const pool = claude ? await ctx.fns.llm.claudePoolSelect({ readOnly: true, ...(opts.claudeAccount ? { preferredAccount: opts.claudeAccount } : {}) }) : null;
        if (pool?.enabled) {
            if (!pool.account) return { error: 'No managed Claude subscription is available' };
            model = `claude-code:${claude![1]}`;
        }
        const created = await ctx.fns.agent.start({ model, title: String(opts.title ?? '').trim().slice(0, 120), workspaceDir, systemPrompt, systemPromptName, systemPromptCore, projectId });
        if (opts.claudeAccount) {
            try { await ctx.fns.llm.claudePoolSelect({ preferredAccount: opts.claudeAccount }); }
            catch { return { agent: created, error: `Agent ${created.id} was created, but the shared Claude account could not be selected. No inference was scheduled; choose the account again before sending a message.` }; }
        }
        const userId = await ctx.fns.auth.actorId({});
        if (userId && systemPromptName) await ctx.fns.agent.rememberSystemPrompt({ userId, name: systemPromptName }).catch(() => null);
        await ctx.fns.procs.db.run({ sql: "INSERT INTO kv (key, value) VALUES ('last-model', ?) ON CONFLICT (key) DO UPDATE SET value = excluded.value", params: [model] }).catch(() => {});
        return { agent: created };
    } catch (error: any) {
        if (opts.createWorkspaceDir !== '1' && String(error?.message ?? '').startsWith('workspace directory not found:')) return { confirmation: { dir: resolve(requestedWorkspace.trim() || process.cwd()), values: opts } };
        return { error: String(error?.message ?? 'Invalid workspace') };
    }
}
