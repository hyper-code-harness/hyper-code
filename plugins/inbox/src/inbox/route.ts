/**
 * Internal: decides which agents of this Hyper an incoming message is for. A recipient <local>@<this host> goes to the agent with
 * that alias (inbox.alias), else to the agent with that id; inbox@host and unknown local parts go to the inbox.defaultAgent setting
 * (or nobody: the message stays in /inbox). Archived agents are skipped.
 * @param opts.to Recipient addresses of the message.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Recipient addresses of the message. */
    to: string[];
}): Promise<string[]> {
    const { host } = await ctx.fns.inbox.whoami({});
    const locals = opts.to.filter(a => a.endsWith(`@${host}`)).map(a => a.slice(0, -host.length - 1));
    const out = new Set<string>();
    const fallback = String(await ctx.fns.settings.getString({ module: "inbox", scopeType: "global", key: "defaultAgent", fallback: "" }) ?? "").trim();
    for (const local of locals) {
        const alias = await ctx.fns.procs.db.select({ sql: "SELECT a.agent_id FROM inbox.aliases a JOIN agents g ON g.id = a.agent_id AND g.archived_at IS NULL WHERE a.name = ?", params: [local] }) as any[];
        if (alias[0]) { out.add(alias[0].agent_id); continue; }
        const agent = local === "inbox" ? [] : await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE lower(id) = ? AND archived_at IS NULL AND visibility <> 'hidden'", params: [local] }) as any[];
        if (agent[0]) { out.add(agent[0].id); continue; }
        if (fallback) out.add(fallback);
    }
    return [...out];
}
