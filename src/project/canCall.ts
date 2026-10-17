/**
 * Decides whether a caller may run a user, project or agent function by its full name.
 *
 * Use before dispatching a call from outside the process (`/rpc`, canvas URLs) to a function of a memory level.
 * Platform and plugin functions (system level) are always allowed here — their own checks apply.
 * `user_<id>.*`: that person and every agent they created. `project_<slug>.*`: agents of that project and
 * signed-in people of this instance. `agent_<id>.*`: that agent itself and the person who created it (the
 * instance owner for agents without a creator).
 * @param opts.name Full dotted function name, e.g. `project_hyperDesign.tables` or `agent_cbuy.schemaSvg`.
 * @param opts.agentId Calling agent; defaults to `session.agentId`.
 * @param opts.userId Calling person's user id; defaults to `session.user.id`.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Full dotted function name, e.g. `project_hyperDesign.tables` or `agent_cbuy.schemaSvg`. */
        name: string;
        /** Calling agent; defaults to `session.agentId`. */
        agentId?: string;
        /** Calling person's user id; defaults to `session.user.id`. */
        userId?: string;
    },
): Promise<{ allowed: boolean; scope: "system" | "user" | "project" | "agent"; owner: string | null; reason: string }> {
    const head = String(opts.name ?? "").split(".")[0] ?? "";
    // An explicit caller replaces the session's: checking for a given person must not inherit the eval's agent.
    const explicit = opts.agentId !== undefined || opts.userId !== undefined;
    const agentId = explicit ? opts.agentId ?? null : (session as any)?.agentId ?? null;
    const userId = explicit ? opts.userId ?? null : (session as any)?.user?.id ?? null;
    const level = await ctx.fns.memory.fnLevel({ module: head });
    if (!level) {
        if (/^(user|project|agent)_/.test(head)) return { allowed: false, scope: "system", owner: null, reason: `${head} names no known person, project or agent` };
        return { allowed: true, scope: "system", owner: null, reason: "system function" };
    }
    const creatorOf = async (id: string) => (await ctx.fns.procs.db.select({ sql: "SELECT created_by FROM agents WHERE id = ?", params: [id] }) as any[])[0];

    if (level.level === "user") {
        if (userId === level.owner) return { allowed: true, scope: "user", owner: level.owner, reason: "the person" };
        if (agentId && (await creatorOf(agentId))?.created_by === level.owner) return { allowed: true, scope: "user", owner: level.owner, reason: "an agent of the person" };
        return { allowed: false, scope: "user", owner: level.owner, reason: `${head} is private to ${level.owner} and their agents` };
    }

    if (level.level === "project") {
        const slug = level.owner;
        if (userId) return { allowed: true, scope: "project", owner: slug, reason: "signed-in person" };
        if (agentId) {
            const rows: any[] = await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM agents a JOIN projects p ON p.id = a.project_id WHERE a.id = ? AND p.slug = ?", params: [agentId, slug] });
            if (rows.length) return { allowed: true, scope: "project", owner: slug, reason: "agent of the project" };
            return { allowed: false, scope: "project", owner: slug, reason: `agent ${agentId} is not in project ${slug}` };
        }
        return { allowed: false, scope: "project", owner: slug, reason: "no caller" };
    }

    const target = level.owner;
    if (agentId === target) return { allowed: true, scope: "agent", owner: target, reason: "the agent itself" };
    const row = await creatorOf(target);
    if (!row) return { allowed: false, scope: "agent", owner: target, reason: `unknown agent ${target}` };
    const createdBy = row.created_by ?? null;
    if (userId && createdBy === userId) return { allowed: true, scope: "agent", owner: target, reason: "the agent's person" };
    // Agents made before sign-in existed have no creator: only the instance owner may call their functions.
    if (userId && createdBy === null && (session as any)?.user?.role === "owner") return { allowed: true, scope: "agent", owner: target, reason: "instance owner, agent has no creator" };
    return { allowed: false, scope: "agent", owner: target, reason: `agent_${target} is private to agent ${target} and its person` };
}
