/**
 * Answers a received message as the agent: to the original sender and the other recipients except this agent's own address,
 * in the same thread, subject kept, hop continued (loops stop at the hop limit). Use for <inbox-message> turns.
 * @param opts.agent Answering agent.
 * @param opts.id Id of the received message (the id attribute of <inbox-message>).
 * @param opts.text Reply body.
 * @param opts.all Also answer the other recipients of the message. @default true
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Answering agent. */
    agent: { id: string };
    /** Id of the received message (the id attribute of <inbox-message>). */
    id: string;
    /** Reply body. */
    text: string;
    /** Also answer the other recipients of the message. @default true */
    all?: boolean;
}): Promise<{ id: string; from: string; to: string[]; wraps: number; thread: string | null; hop: number }> {
    const rows = await ctx.fns.procs.db.select({ sql: "SELECT id, from_addr, to_addrs, subject, thread, hop, verified FROM inbox.messages WHERE id = ? AND direction = 'in'", params: [opts.id] }) as any[];
    const m = rows[0];
    if (!m) throw new Error(`inbox.reply: no received message ${opts.id}`);
    if (!m.verified) throw new Error("inbox.reply: the message is quarantined (unverified sender); ask your user before answering it");
    const me = await ctx.fns.inbox.addressOf({ agentId: opts.agent.id });
    const { host } = await ctx.fns.inbox.whoami({});
    const toAddrs: string[] = typeof m.to_addrs === "string" ? JSON.parse(m.to_addrs) : m.to_addrs;
    const others = opts.all === false ? [] : toAddrs.filter(a => a !== me && !a.endsWith(`@${host}`));
    const to = [...new Set([m.from_addr, ...others])];
    const subject = m.subject ? (/^re:/i.test(m.subject) ? m.subject : `Re: ${m.subject}`) : undefined;
    const sent = await ctx.fns.inbox.send({ agent: opts.agent, to, text: opts.text, subject, thread: m.thread ?? m.id, hop: Number(m.hop) });
    await ctx.fns.procs.db.run({ sql: "UPDATE inbox.messages SET read_at = COALESCE(read_at, ?) WHERE id = ? AND direction = 'in'", params: [Date.now(), opts.id] });
    return sent;
}
