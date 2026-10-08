import { hexToBytes } from "@noble/hashes/utils.js";

const MAX_HOPS = 8;
const MAX_PER_10_MIN = 30;

/**
 * Sends end-to-end encrypted mail from an agent of this Hyper to people (work email) or to agents of other Hyper environments
 * (<agent id or role>@<their Hyper host>). The sender address is <agent alias or id>@<this host>. One message is sealed with this
 * Hyper's key and gift-wrapped for every active key of every recipient (NIP-17/NIP-59/NIP-44); the relay only sees opaque wraps.
 * hop counts the chain: a new message has hop 0, a reply to a message with hop n has n + 1; past 8 sending is refused to stop mail loops.
 * At most 30 messages per agent in 10 minutes. Throws on an unknown address or an address without keys.
 * @param opts.agent Sending agent; its alias or id becomes the local part of the sender address.
 * @param opts.to Recipient addresses.
 * @param opts.text Message body (plain text or Markdown).
 * @param opts.subject Subject line.
 * @param opts.thread Root message id of the thread this message continues.
 * @param opts.hop Hop of the message being answered (the new message gets hop + 1); omit for a new conversation.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Sending agent; its alias or id becomes the local part of the sender address. */
    agent: { id: string };
    /** Recipient addresses. */
    to: string[];
    /** Message body (plain text or Markdown). */
    text: string;
    /** Subject line. */
    subject?: string;
    /** Root message id of the thread this message continues. */
    thread?: string;
    /** Hop of the message being answered (the new message gets hop + 1); omit for a new conversation. */
    hop?: number;
}): Promise<{ id: string; from: string; to: string[]; wraps: number; thread: string | null; hop: number }> {
    const text = String(opts.text ?? "").trim();
    const to = [...new Set((opts.to ?? []).map(a => String(a).trim().toLowerCase()).filter(Boolean))];
    if (!opts.agent?.id) throw new Error("inbox.send: agent is required");
    if (!to.length) throw new Error("inbox.send: at least one recipient address is required");
    if (!text) throw new Error("inbox.send: text is required");
    if (text.length > 32_000) throw new Error("inbox.send: text is longer than 32000 characters");
    const hop = opts.hop == null ? 0 : Math.max(0, Math.trunc(Number(opts.hop))) + 1;
    if (hop > MAX_HOPS) throw new Error(`inbox.send: hop limit ${MAX_HOPS} reached — stop the mail exchange and report to your user instead`);
    const recent = await ctx.fns.procs.db.select({ sql: "SELECT count(*)::int AS n FROM inbox.messages WHERE direction = 'out' AND agent_id = ? AND received_at > ?", params: [opts.agent.id, Date.now() - 10 * 60_000] }) as any[];
    if (Number(recent[0]?.n ?? 0) >= MAX_PER_10_MIN) throw new Error("inbox.send: rate limit — too many messages from this agent in 10 minutes");

    const c = await ctx.fns.inbox.connection({});
    if (!c) throw new Error("inbox.send: this Hyper has no inbox key yet — run inbox.register");
    const { conn, identity } = c;
    const from = await ctx.fns.inbox.addressOf({ agentId: opts.agent.id });
    const { createRumor, createSeal, createWrap } = await import("nostr-tools/nip59");
    const sk = hexToBytes(conn.sk);
    const tags: string[][] = [["from", from], ...to.map(a => ["to", a]), ["hop", String(hop)]];
    if (opts.subject) tags.push(["subject", String(opts.subject).slice(0, 200)]);
    if (opts.thread) tags.push(["e", opts.thread, "", "root"]);
    const rumor = createRumor({ kind: 14, content: text, tags }, sk);
    const targets = new Set<string>();
    for (const addr of to) {
        const a = await ctx.fns.inbox.lookup({ conn, addr });
        if (!a) throw new Error(`inbox.send: unknown address ${addr}`);
        if (!a.keys.length) throw new Error(`inbox.send: ${addr} has no active keys (nobody can read it yet)`);
        for (const k of a.keys) targets.add(k.npub);
    }
    // Other instances of this same Hyper principal (if any) get a copy; this instance keeps its own in inbox.messages.
    const mine = await ctx.fns.inbox.lookup({ conn, addr: `inbox@${identity.host}` }).catch(() => null);
    for (const k of mine?.keys ?? []) targets.add(k.npub);
    targets.delete(conn.npub);
    const wraps = [...targets].map(pk => createWrap(createSeal(rumor, sk, pk), pk));
    for (let i = 0; i < wraps.length; i += 100) {
        const r = await ctx.fns.inbox.request({ conn, method: "POST", path: "/v1/relay/events", body: { events: wraps.slice(i, i + 100) } });
        if (r.status !== 200) throw new Error(`inbox.send: relay refused (${r.status} ${r.body?.error ?? ""})`);
    }
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO inbox.messages (id, direction, agent_id, from_addr, to_addrs, subject, body, thread, hop, verified, sender_principal, created_at, received_at, delivered_at, read_at)
              VALUES (?, 'out', ?, ?, ?::jsonb, ?, ?, ?, ?, true, ?, ?, ?, ?, ?) ON CONFLICT DO NOTHING`,
        params: [rumor.id, opts.agent.id, from, JSON.stringify(to), opts.subject ?? null, text, opts.thread ?? null, hop, identity.principal, rumor.created_at * 1000, now, now, now],
    });
    return { id: rumor.id, from, to, wraps: wraps.length, thread: opts.thread ?? null, hop };
}
