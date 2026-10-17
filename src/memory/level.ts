/**
 * Resolves which memory level a write goes to and checks that the calling agent may write there.
 *
 * Use inside memory writers (memory.write, memory.put) to turn the `visibility` option into the folder and the
 * ids of the row. `agent` (default) is this agent; `user` is the agent's person, shared by all of that person's
 * agents in every project; `project` needs the agent to be in a project; `system` is shared with everyone on the
 * instance and only the instance owner's agents may write it (agents propose, the owner asks).
 * @param opts.visibility Target level. @default agent
 * @param opts.action Name of the calling function, used in error messages.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Target level. @default agent */
        visibility?: "agent" | "project" | "user" | "system";
        /** Name of the calling function, used in error messages. */
        action: string;
    },
): Promise<{ visibility: "agent" | "project" | "user" | "system"; dir: string; projectId: string | null; userId: string | null; agentId: string | null; writer: string }> {
    const s = await ctx.fns.memory.scope({});
    const visibility = opts.visibility ?? "agent";
    if (visibility === "agent") return { visibility, dir: s.agentDir, projectId: null, userId: null, agentId: s.agentId, writer: s.agentId };
    if (visibility === "project") {
        if (!s.projectDir || !s.projectId) throw new Error(`${opts.action}: agent has no project; use visibility "agent" or "user"`);
        return { visibility, dir: s.projectDir, projectId: s.projectId, userId: null, agentId: null, writer: s.agentId };
    }
    if (visibility === "user") {
        if (!s.userDir || !s.userId) throw new Error(`${opts.action}: agent has no person (created_by is empty); use visibility "agent"`);
        return { visibility, dir: s.userDir, projectId: null, userId: s.userId, agentId: null, writer: s.agentId };
    }
    if (visibility === "system") {
        const rows: any[] = s.userId ? await ctx.fns.procs.db.select({ sql: "select role from users where id = ?", params: [s.userId] }) : [];
        if (rows[0]?.role !== "owner") throw new Error(`${opts.action}: system memory is shared with everyone; only the instance owner's agents write it — propose the change to your person`);
        return { visibility, dir: s.systemDir, projectId: null, userId: null, agentId: null, writer: s.agentId };
    }
    throw new Error(`${opts.action}: unknown visibility ${visibility}`);
}
