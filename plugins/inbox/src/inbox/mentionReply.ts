/**
 * Internal (inbox.sync): brings a reply to a mailed @mention back into its chat. A verified message whose thread is a mention mail
 * sent to person P counts only when it comes from P's own address (sender principal user:<P's email>) and P is still an active user
 * of this Hyper: then it is appended to the chat AS P's message (not as third-party mail), P's mentions in that chat are marked read
 * and the chat agent is woken. Anything else returns handled: false and is routed as ordinary mail.
 * @param opts.message The received, verified message.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** The received, verified message. */
    message: types.inbox.Message;
}): Promise<{ handled: boolean; agentId: string | null; messageIdx: number | null }> {
    const m = opts.message;
    const none = { handled: false, agentId: null, messageIdx: null };
    if (!m.verified || !m.thread || !m.senderPrincipal?.startsWith("user:")) return none;
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT agent_id, to_user, to_addr FROM inbox.mention_mail WHERE message_id = ? LIMIT 1", params: [m.thread] }) as any[];
    const mail = rows[0]; if (!mail) return none;
    const email = m.senderPrincipal.slice(5).toLowerCase();
    if (email !== String(mail.to_addr ?? "").toLowerCase() || m.from !== email) return none;
    const user = await ctx.fns.auth.getUser({ id: String(mail.to_user) });
    if (!user || user.email?.trim().toLowerCase() !== email) return none;
    const live = await ctx.fns.procs.db.select({ sql: "SELECT id FROM agents WHERE id = ? AND archived_at IS NULL", params: [mail.agent_id] }) as any[];
    if (!live.length) return none;
    const text = m.text.replace(/<\/?inbox-message[^>]*>/gi, "").trim();
    if (!text) return none;
    const out = await ctx.fns.session.appendUserMessage({ id: String(mail.agent_id), text, author: String(mail.to_user), eventExtra: { inboxMessage: { id: m.id, from: m.from, mentionReply: true } } });
    const agent = (ctx.state as any).agent?.[mail.agent_id];
    if (agent) await ctx.fns.session.syncAgentState({ agent });
    await ctx.fns.mentions.markRead({ agentId: String(mail.agent_id), userId: String(mail.to_user) });
    const now = Date.now();
    await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = COALESCE(next_run_at, ?), updated_at = ? WHERE id = ? AND archived_at IS NULL", params: [now, now, mail.agent_id] });
    ctx.fns.agent.wakeWorker({});
    return { handled: true, agentId: String(mail.agent_id), messageIdx: out.idx };
}
