/**
 * Send a message from one agent into another agent's session under the sender's own name.
 *
 * The text lands in the target transcript as a human-turn row with author `agent:<senderId>`,
 * message_type `agent_message`, wrapped in an `<agent-message from=... hop=...>` envelope so the
 * receiving model knows who wrote it and whom to answer (with agent.message back to `from`).
 * The UI shows it as a separate bubble with the sender agent's name and a link to it.
 * Allowed targets: the sender's parent or direct children, agents of the same owner, and
 * published shared agents. A hop counter (reply chain length) and a per-pair rate limit stop
 * ping-pong loops between agents. Use for agent-to-agent conversation; use agent.delegate for
 * new sub-tasks and agent.steer for structured team progress.
 * @param opts.agent Sending agent (its id becomes the author).
 * @param opts.to Target agent id.
 * @param opts.text Message body; must be non-empty.
 * @param opts.wake Queue the target so it processes the message right away. @default true
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Sending agent (its id becomes the author). */
        agent: types.agent.Agent;
        /** Target agent id. */
        to: string;
        /** Message body; must be non-empty. */
        text: string;
        /** Queue the target so it processes the message right away. @default true */
        wake?: boolean;
    },
): Promise<{ delivered: true; to: string; messageIdx: number; hop: number }> {
    const MAX_HOPS = 8;
    const MAX_PER_10_MIN = 30;
    const sender = opts.agent;
    const to = String(opts.to ?? "").trim();
    const text = String(opts.text ?? "").trim();
    if (!sender?.id) throw new Error("agent.message: agent is required");
    if (!to || !text) throw new Error("agent.message: to and text are required");
    if (to === sender.id) throw new Error("agent.message: cannot message yourself");

    const rows = (await ctx.fns.procs.db.select({
        sql: "SELECT id, title, parent_id, created_by FROM agents WHERE id IN (?, ?) AND archived_at IS NULL",
        params: [sender.id, to],
    })) as any[];
    const target = rows.find((r) => r.id === to);
    const from = rows.find((r) => r.id === sender.id);
    if (!target) throw new Error("agent.message: target agent not found or archived: " + to);

    // Who may write where: family (parent/child), same owner, or a published shared agent.
    const family = String(target.parent_id ?? "") === sender.id || String(sender.parentId ?? from?.parent_id ?? "") === to;
    const owner = from?.created_by ?? sender.createdBy ?? null;
    // Chats created before users existed (created_by NULL) belong to the single/first owner.
    const sameOwner = String(target.created_by ?? "") === String(owner ?? "");
    const published = !family && !sameOwner
        ? ((await ctx.fns.procs.db.select({ sql: "SELECT 1 FROM kv WHERE key = ?", params: ["shared-agent:" + to] })) as any[]).length > 0
        : false;
    if (!family && !sameOwner && !published) throw new Error("agent.message: not allowed to message agent " + to + " (not family, not same owner, not published)");

    // Hop = length of the agent-to-agent reply chain. If the sender is currently answering an
    // agent message, continue its counter; a human turn resets it.
    const last = (await ctx.fns.procs.db.select({
        sql: "SELECT content, message_type FROM messages WHERE agent_id = ? AND role = 'user' AND excluded_from_cursor = 0 ORDER BY idx DESC LIMIT 1",
        params: [sender.id],
    })) as any[];
    const prevHop = last[0]?.message_type === "agent_message" ? Number(/hop="(\d+)"/.exec(String(last[0].content))?.[1] ?? 0) : 0;
    const hop = prevHop + 1;
    if (hop > MAX_HOPS) throw new Error(`agent.message: hop limit ${MAX_HOPS} reached — stop the agent-to-agent exchange and report to your user instead`);

    const since = Date.now() - 10 * 60_000;
    const recent = (await ctx.fns.procs.db.select({
        sql: "SELECT COUNT(*)::int AS n FROM messages WHERE agent_id = ? AND author = ? AND ts > ?",
        params: [to, "agent:" + sender.id, since],
    })) as any[];
    if (Number(recent[0]?.n ?? 0) >= MAX_PER_10_MIN) throw new Error("agent.message: rate limit — too many messages to " + to + " in 10 minutes");

    const title = String(sender.title ?? from?.title ?? "").replace(/["<>\n]/g, " ").slice(0, 80);
    const onBehalfOf = owner ? String(owner) : null;
    const ownerName = onBehalfOf ? (await ctx.fns.auth.getUser({ id: onBehalfOf }).catch(() => null) as any)?.name ?? onBehalfOf : null;
    const attrs = `from="${sender.id}" title="${title}" hop="${hop}"` + (ownerName ? ` on-behalf-of="${String(ownerName).replace(/["<>\n]/g, " ")}"` : "");
    const content = `<agent-message ${attrs}>\n${text}\n</agent-message>`;

    const out = await ctx.fns.session.appendUserMessage({
        id: to,
        text: content,
        author: "agent:" + sender.id,
        messageType: "agent_message",
        eventExtra: { agentMessage: { from: sender.id, title, hop, body: text, onBehalfOf } },
    });
    const live = (ctx.state as any).agent?.[to];
    if (live) await ctx.fns.session.syncAgentState({ agent: live });
    if (opts.wake !== false) {
        const now = Date.now();
        await ctx.fns.procs.db.run({ sql: "UPDATE agents SET next_run_at = COALESCE(next_run_at, ?), updated_at = ? WHERE id = ? AND archived_at IS NULL", params: [now, now, to] });
        ctx.fns.agent.wakeWorker({});
    }
    return { delivered: true, to, messageIdx: out.idx, hop };
}
