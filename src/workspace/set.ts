/**
 * Changes the agent's workspace: a local directory, or a directory on an SSH host.
 *
 * With host the directory is checked on that machine and stored as its absolute
 * remote path; from then on read/write/edit/grep/find/bash without an explicit
 * host act there, and relative paths resolve against it. Without host the
 * workspace becomes local again (existing UI and callers keep their meaning).
 * @param opts.dir Workspace directory; with host a path on that host (relative and ~ resolve against the remote home).
 * @param opts.host SSH host alias from ~/.ssh/config (see remote.servers); omitted or empty makes the workspace local.
 * @param opts.agent Agent to change; defaults to the calling session's agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Workspace directory; with host a path on that host (relative and ~ resolve against the remote home). */
        dir: string;
        /** SSH host alias from ~/.ssh/config (see remote.servers); omitted or empty makes the workspace local. */
        host?: string;
        /** Agent to change; defaults to the calling session's agent. */
        agent?: types.agent.Agent;
    },
): Promise<string> {
    const agent = opts.agent ?? session?.agent;
    if (!agent) throw new Error("workspace.set requires an agent session");
    const host = String(opts.host ?? "").trim();
    const dir = await ctx.fns.workspace.normalize({ dir: opts.dir, host });
    await ctx.fns.procs.db.run({
        sql: "UPDATE agents SET workspace_dir = ?, workspace_host = ?, updated_at = ? WHERE id = ?",
        params: [dir, host, Date.now(), agent.id],
    });
    agent.workspaceDir = dir;
    agent.workspaceHost = host;
    await ctx.fns.events.emitAgentsChanged({ agentId: agent.id, reason: "workspace" });
    return host ? `${host}:${dir}` : dir;
}
