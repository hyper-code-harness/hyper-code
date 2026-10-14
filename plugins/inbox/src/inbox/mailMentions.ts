/**
 * Mails unread @mentions to the mentioned people through the inbox, so they get a notification on their devices (Hyperlet on the
 * Mac, later the phone) even with no Hyper tab open. Takes mentions that are still unread after minAgeMs (a person reading the chat
 * in time gets no mail), not older than a day and never mailed, and sends ONE message per chat and person: from the chat agent's
 * address to the person's sign-in email, labeled `mention`, with a link to the chat on this Hyper. Every mention is recorded once
 * (sent or failed: a person without an inbox is not retried); a reply in the mail's thread comes back into the chat (inbox.sync).
 * No-op while inbox.enabled is off. Use from the inbox-mentions cron; call by hand to flush now.
 * @param opts.minAgeMs Mail only mentions unread for at least this long. @default 60000 @minimum 0
 * @param opts.force Run even when inbox.enabled is off (tests, a manual flush). @default false
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Mail only mentions unread for at least this long. @default 60000 @minimum 0 */
    minAgeMs?: number;
    /** Run even when inbox.enabled is off (tests, a manual flush). @default false */
    force?: boolean;
}): Promise<{ sent: number; failed: number; mentions: number }> {
    const enabled = await ctx.fns.settings.get({ module: "inbox", scopeType: "global", key: "enabled" });
    if (!opts.force && enabled !== true && enabled !== "true") return { sent: 0, failed: 0, mentions: 0 };
    const now = Date.now(); const minAge = Math.max(0, opts.minAgeMs ?? 60_000);
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT m.id, m.agent_id, m.message_idx, m.from_actor, m.to_user, m.excerpt, m.created_at, a.title
                FROM mentions m JOIN agents a ON a.id = m.agent_id AND a.archived_at IS NULL
               WHERE m.read_at IS NULL AND m.created_at <= ? AND m.created_at > ?
                 AND NOT EXISTS (SELECT 1 FROM inbox.mention_mail s WHERE s.mention_id = m.id)
               ORDER BY m.agent_id, m.to_user, m.created_at, m.id LIMIT 200`,
        params: [now - minAge, now - 24 * 3600_000],
    }) as any[];
    if (!rows.length) return { sent: 0, failed: 0, mentions: 0 };
    const { host } = await ctx.fns.inbox.whoami({});
    const people = new Map((await ctx.fns.mentions.people({})).map(p => [p.id, p]));
    const who = (from: string | null) => !from ? "Someone" : from.startsWith("agent:") ? `Agent ${from.slice(6)}` : people.get(from)?.name ?? from;
    const groups = new Map<string, any[]>();
    for (const r of rows) { const k = `${r.agent_id}\u0000${r.to_user}`; (groups.get(k) ?? groups.set(k, []).get(k)!).push(r); }
    let sent = 0, failed = 0;
    for (const items of groups.values()) {
        const first = items[0]; const title = String(first.title ?? first.agent_id).slice(0, 120);
        const user = await ctx.fns.auth.getUser({ id: String(first.to_user) });
        const email = user?.email?.trim().toLowerCase() || null;
        const link = `https://${host}/agent/${encodeURIComponent(first.agent_id)}#m-${items[items.length - 1].message_idx}`;
        const text = [...items.map(r => `${who(r.from_actor)}: ${String(r.excerpt)}`), "", `Open the chat: ${link}`, "Reply to this message to answer in the chat."].join("\n");
        let messageId: string | null = null; let error: string | null = null;
        if (!email) error = "the mentioned user has no email";
        else try {
            const r = await ctx.fns.inbox.send({ agent: { id: String(first.agent_id) }, to: [email], text, subject: `Mention in «${title}»`, labels: ["mention"], link });
            messageId = r.id; sent++;
        } catch (e: any) { error = String(e?.message ?? e).slice(0, 300); }
        if (error) failed++;
        for (const r of items) await ctx.fns.procs.db.run({
            sql: `INSERT INTO inbox.mention_mail (mention_id, agent_id, to_user, to_addr, message_id, error, created_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
            params: [r.id, r.agent_id, r.to_user, email, messageId, error, Date.now()],
        });
        if (error) ctx.fns.procs.log.info({ event: "inbox.mention.unsent", msg: `${first.to_user} in ${first.agent_id}: ${error}` });
    }
    return { sent, failed, mentions: rows.length };
}
