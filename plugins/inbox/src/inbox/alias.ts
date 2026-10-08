/**
 * Gives an agent a stable inbox name: mail to <name>@<host> is delivered to it and it sends as <name>@<host>
 * (for example reviewer, recruiter). One name per agent role; re-assigning a name moves it to the new agent.
 * Pass remove to drop the name. Names: lowercase letters, digits, dot, dash; inbox is reserved.
 * @param opts.name Local part, for example reviewer.
 * @param opts.agentId Agent that owns the name; required unless remove is set.
 * @param opts.remove Drop the name. @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Local part, for example reviewer. */
    name: string;
    /** Agent that owns the name; required unless remove is set. */
    agentId?: string;
    /** Drop the name. @default false */
    remove?: boolean;
}): Promise<{ name: string; agentId: string | null; address: string | null }> {
    const name = String(opts.name ?? "").trim().toLowerCase();
    if (!/^[a-z0-9][a-z0-9.-]{0,62}$/.test(name) || name === "inbox") throw new Error("inbox.alias: name must be lowercase letters, digits, dot or dash, and not inbox");
    if (opts.remove) {
        await ctx.fns.procs.db.run({ sql: "DELETE FROM inbox.aliases WHERE name = ?", params: [name] });
        return { name, agentId: null, address: null };
    }
    const agentId = String(opts.agentId ?? "").trim();
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id = ? AND archived_at IS NULL", params: [agentId] }) as any[];
    if (!rows.length) throw new Error(`inbox.alias: agent not found or archived: ${agentId}`);
    await ctx.fns.procs.db.run({ sql: "INSERT INTO inbox.aliases (name, agent_id, created_at) VALUES (?, ?, ?) ON CONFLICT (name) DO UPDATE SET agent_id = EXCLUDED.agent_id", params: [name, agentId, Date.now()] });
    const { host } = await ctx.fns.inbox.whoami({});
    return { name, agentId, address: `${name}@${host}` };
}
