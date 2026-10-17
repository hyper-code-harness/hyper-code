/**
 * Resolves the four memory levels the calling agent can see: system, its person (user), its project, itself.
 *
 * Use before reading or writing memory to learn the folders and ids, or to show where memory lives. All memory
 * files live on this instance under `~/.hyper/memory` (`HYPER_HOME` overrides `~/.hyper`): system at the root,
 * `users/<userId>/`, `projects/<slug>/`, `agents/<id>/`; functions under `~/.hyper/src/{user_,project_,agent_}…`.
 * `visibleSql` / `visibleParams` is the one visibility filter for the `memory` table, used by every memory.*
 * function, and `order` ranks a key found on several levels: agent, then project, then user, then system.
 * @param opts.agentId Agent to resolve; defaults to the calling agent.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent to resolve; defaults to the calling agent. */
        agentId?: string;
    },
): Promise<{
    agentId: string; userId: string | null; projectId: string | null; projectSlug: string | null;
    home: string; systemDir: string; userDir: string | null; projectDir: string | null; agentDir: string;
    srcDir: string; dirs: Array<{ level: "agent" | "project" | "user" | "system"; dir: string }>;
    visibleSql: string; visibleParams: Array<string | null>; order: string;
}> {
    const agentId = opts.agentId ?? (session as any)?.agentId;
    if (!agentId) throw new Error("memory.scope: no agent in session; pass agentId");
    const rows: any[] = await ctx.fns.procs.db.select({ sql: "select a.id, a.project_id, a.created_by, p.slug from agents a left join projects p on p.id = a.project_id where a.id = ?", params: [agentId] });
    if (!rows.length) throw new Error(`memory.scope: unknown agent ${agentId}`);
    const r = rows[0];
    const home = await ctx.fns.memory.home({});
    const { resolve } = await import("node:path");
    const systemDir = resolve(home, "memory");
    const userId: string | null = r.created_by ?? null;
    const projectSlug: string | null = r.slug ?? null;
    const userDir = userId ? resolve(systemDir, "users", userId) : null;
    const projectDir = projectSlug ? resolve(systemDir, "projects", projectSlug) : null;
    const agentDir = resolve(systemDir, "agents", agentId);
    const dirs: Array<{ level: "agent" | "project" | "user" | "system"; dir: string }> = [{ level: "agent", dir: agentDir }];
    if (projectDir) dirs.push({ level: "project", dir: projectDir });
    if (userDir) dirs.push({ level: "user", dir: userDir });
    dirs.push({ level: "system", dir: systemDir });
    return {
        agentId, userId, projectId: r.project_id ?? null, projectSlug,
        home, systemDir, userDir, projectDir, agentDir, srcDir: resolve(home, "src"), dirs,
        visibleSql: "(visibility = 'system' or (visibility = 'user' and user_id = ?) or (visibility = 'project' and project_id = ?) or (visibility = 'agent' and agent_id = ?))",
        visibleParams: [userId, r.project_id ?? null, agentId],
        order: "case visibility when 'agent' then 0 when 'project' then 1 when 'user' then 2 else 3 end",
    };
}
