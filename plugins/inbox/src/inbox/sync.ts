/**
 * Fetches new mail for this Hyper from the relay once (long poll up to wait seconds), decrypts and verifies each message, stores it
 * in inbox.messages and delivers verified ones to the addressed agents (inbox.route → inbox.deliver). Unverified messages are kept
 * as quarantined (verified false, reason) and never delivered. Advances the stored cursor only after storing. Safe to call
 * concurrently with the background loop: storage is idempotent by message id.
 * @param opts.wait Long poll seconds, 0..30. @default 0
 * @param opts.limit Maximum wraps per call. @default 100
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Long poll seconds, 0..30. @default 0 */
    wait?: number;
    /** Maximum wraps per call. @default 100 */
    limit?: number;
}): Promise<{ received: number; delivered: number; quarantined: number; dropped: number; cursor: number }> {
    const c = await ctx.fns.inbox.connection({});
    if (!c) throw new Error("inbox.sync: this Hyper has no inbox key yet — run inbox.register");
    const after = Number(await ctx.fns.inbox.getState({ key: "cursor" }) ?? 0);
    const q = new URLSearchParams({ after: String(after), wait: String(Math.max(0, Math.min(30, opts.wait ?? 0))), limit: String(opts.limit ?? 100) });
    const r = await ctx.fns.inbox.request({ conn: c.conn, method: "GET", path: `/v1/relay/inbox?${q}` });
    if (r.status !== 200) throw new Error(`inbox.sync: relay refused (${r.status} ${r.body?.error ?? ""})`);
    let received = 0, delivered = 0, quarantined = 0, dropped = 0;
    for (const { seq, event } of r.body.events as { seq: number; event: any }[]) {
        const m = await ctx.fns.inbox.open({ conn: c.conn, wrap: event });
        if (!m) { dropped++; continue; }
        const now = Date.now();
        const ins = await ctx.fns.procs.db.select({
            sql: `INSERT INTO inbox.messages (id, direction, from_addr, to_addrs, subject, body, thread, hop, verified, reason, sender_principal, seq, created_at, received_at)
                  VALUES (?, 'in', ?, ?::jsonb, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING RETURNING id`,
            params: [m.id, m.from, JSON.stringify(m.to), m.subject, m.text, m.thread, m.hop, m.verified, m.reason, m.senderPrincipal, seq, m.createdAt, now],
        }) as any[];
        if (!ins.length) continue; // the same message reached this key twice
        received++;
        if (!m.verified) { quarantined++; continue; }
        const stored: types.inbox.Message = { ...m, direction: "in", agentId: null, receivedAt: now, deliveredAt: null, readAt: null };
        for (const agentId of await ctx.fns.inbox.route({ to: m.to })) {
            const d = await ctx.fns.inbox.deliver({ agentId, message: stored });
            if (d.delivered) {
                delivered++;
                await ctx.fns.procs.db.run({ sql: "UPDATE inbox.messages SET agent_id = COALESCE(agent_id, ?), delivered_at = ? WHERE id = ? AND direction = 'in'", params: [agentId, Date.now(), m.id] });
            }
        }
    }
    await ctx.fns.inbox.setState({ key: "cursor", value: r.body.cursor });
    if (received) ctx.fns.procs.log.info({ event: "inbox.received", msg: `${received} message(s), ${delivered} delivered, ${quarantined} quarantined` });
    return { received, delivered, quarantined, dropped, cursor: r.body.cursor };
}
