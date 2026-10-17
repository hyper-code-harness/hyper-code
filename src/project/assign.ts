/**
 * Attach an agent to a project (or detach it) and move its workspace to the project's defaultDir
 *
 * Sets agents.project_id for the agent and, unless keepWorkspace is true, switches the agent's workspace to the project's defaultDir/defaultHost via workspace.set, so files, bash, git and memory all point at the project. Pass project: null to detach. Use after project.create or to move an existing chat into a project.
 * @param opts.project Project id or slug; null detaches the agent from any project.
 * @param opts.agentId Agent to attach; defaults to the calling agent.
 * @param opts.keepWorkspace Keep the agent's current workspace instead of switching to defaultDir. @default false
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Project id or slug; null detaches the agent from any project. */
        project: string | null;
        /** Agent to attach; defaults to the calling agent. */
        agentId?: string;
        /** Keep the agent's current workspace instead of switching to defaultDir. @default false */
        keepWorkspace?: boolean;
    },
): Promise<{ agentId: string; projectId: string | null; workspace: string | null }> {
    const agentId = opts.agentId ?? (session as any)?.agentId ?? (session as any)?.agent?.id;
        if (!agentId) throw new Error("project.assign: no agent; pass agentId");
        const p = opts.project == null ? null : (await ctx.fns.project.get({ id: opts.project })) ?? (await ctx.fns.project.get({ slug: opts.project }));
        if (opts.project != null && !p) throw new Error(`project.assign: unknown project ${opts.project}`);
        await ctx.fns.procs.db.run({ sql: "update agents set project_id = ?, updated_at = ? where id = ?", params: [p?.id ?? null, Date.now(), agentId] });
        const live = (ctx.state as any).agent?.[agentId];
        if (live) live.projectId = p?.id ?? null;
        let workspace: string | null = null;
        if (p?.defaultDir && !opts.keepWorkspace && live) workspace = await ctx.fns.workspace.set({ agent: live, dir: p.defaultDir, host: p.defaultHost });
        else if (p?.defaultDir && !opts.keepWorkspace) {
          await ctx.fns.procs.db.run({ sql: "update agents set workspace_dir = ?, workspace_host = ? where id = ?", params: [p.defaultDir, p.defaultHost, agentId] });
          workspace = p.defaultHost ? `${p.defaultHost}:${p.defaultDir}` : p.defaultDir;
        }
        await ctx.fns.events.emitAgentsChanged({ agentId, reason: "project" });
        return { agentId, projectId: p?.id ?? null, workspace };
}
