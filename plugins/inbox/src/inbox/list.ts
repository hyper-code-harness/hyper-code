/**
 * Lists stored inbox mail of this Hyper, newest first: received (verified and quarantined) and sent messages, optionally for one
 * agent, one thread, one direction or only quarantined ones.
 * @param opts.agentId Only messages delivered to or sent by this agent.
 * @param opts.thread Only messages of this thread (root id), oldest first.
 * @param opts.direction Only received (in) or sent (out) messages.
 * @param opts.quarantined Only messages whose sender could not be verified. @default false
 * @param opts.limit Maximum rows. @default 50
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Only messages delivered to or sent by this agent. */
    agentId?: string;
    /** Only messages of this thread (root id), oldest first. */
    thread?: string;
    /** Only received (in) or sent (out) messages. */
    direction?: "in" | "out";
    /** Only messages whose sender could not be verified. @default false */
    quarantined?: boolean;
    /** Maximum rows. @default 50 */
    limit?: number;
}): Promise<types.inbox.Message[]> {
    const where: string[] = []; const params: unknown[] = [];
    if (opts.agentId) { where.push("agent_id = ?"); params.push(opts.agentId); }
    if (opts.thread) { where.push("(thread = ? OR id = ?)"); params.push(opts.thread, opts.thread); }
    if (opts.direction) { where.push("direction = ?"); params.push(opts.direction); }
    if (opts.quarantined) where.push("NOT verified");
    const limit = Math.max(1, Math.min(500, Math.trunc(Number(opts.limit ?? 50))));
    const rows = await ctx.fns.procs.db.select({
        sql: `SELECT id, direction, agent_id AS "agentId", from_addr AS "from", to_addrs AS "to", subject, body AS text, thread, hop, verified, reason,
                     sender_principal AS "senderPrincipal", created_at AS "createdAt", received_at AS "receivedAt", delivered_at AS "deliveredAt", read_at AS "readAt"
              FROM inbox.messages ${where.length ? "WHERE " + where.join(" AND ") : ""}
              ORDER BY received_at ${opts.thread ? "ASC" : "DESC"} LIMIT ${limit}`,
        params,
    }) as any[];
    return rows.map(r => ({ ...r, to: typeof r.to === "string" ? JSON.parse(r.to) : r.to, createdAt: Number(r.createdAt), receivedAt: Number(r.receivedAt),
        deliveredAt: r.deliveredAt == null ? null : Number(r.deliveredAt), readAt: r.readAt == null ? null : Number(r.readAt), hop: Number(r.hop) }));
}
