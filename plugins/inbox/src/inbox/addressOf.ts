/**
 * Returns the inbox address of an agent of this Hyper: <alias>@<host> when the agent has an alias (inbox.alias), else <agent id>@<host>.
 * @param opts.agentId Agent id.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent id. */
    agentId: string;
}): Promise<string> {
    const { host } = await ctx.fns.inbox.whoami({});
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT name FROM inbox.aliases WHERE agent_id = ? ORDER BY created_at LIMIT 1", params: [opts.agentId] }) as any[];
    return `${rows[0]?.name ?? opts.agentId.toLowerCase()}@${host}`;
}
