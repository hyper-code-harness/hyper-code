/**
 * Tells whether the signed-in person may see and stop the background jobs of a chat
 *
 * Access check for the chat's jobs badge and popup. A call without a signed-in person (an agent, a local open instance) is allowed, like the rest of the chat UI; an owner sees every chat; a member sees the chats they created, and a team child created by nobody counts as its parent's.
 * @param opts.agentId Agent (chat) whose jobs are asked for.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Agent (chat) whose jobs are asked for. */
        agentId: string;
    },
): Promise<boolean> {
    const user = (session as any)?.user;
        if (!user?.id) return true;
        if (user.role === "owner") return true;
        let id: string | null = String(opts.agentId ?? "");
        // a child made by an agent has no creator of its own: walk up to the chat a person started
        for (let hop = 0; id && hop < 8; hop++) {
            const rows: Array<{ created_by: string | null; parent_id: string | null }> = await ctx.fns.procs.db.select({ sql: "SELECT created_by, parent_id FROM agents WHERE id = ?", params: [id] }) as any[];
            const row = rows[0];
            if (!row) return false;
            if (row.created_by) return row.created_by === user.id;
            id = row.parent_id ?? null;
        }
        return false;
}
