import { hexToBytes } from "@noble/hashes/utils.js";

/**
 * Internal: decrypts one gift wrap addressed to this Hyper (NIP-59: wrap → seal with valid signature → rumor whose author equals the
 * seal key) and verifies the sender: the seal key must be an active key in the relay directory and the claimed from address must
 * belong to that same principal. Returns null when the wrap is not decryptable or not a mail message; a decrypted but unverified
 * message comes back with verified false and a reason, and must be quarantined, never handed to an agent as trusted.
 * @param opts.conn Relay connection with this Hyper's key.
 * @param opts.wrap Gift wrap event (kind 1059) from the relay.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Relay connection with this Hyper's key. */
    conn: types.inbox.Conn;
    /** Gift wrap event (kind 1059) from the relay. */
    wrap: { id: string; pubkey: string; created_at: number; kind: number; tags: string[][]; content: string; sig: string };
}): Promise<{ id: string; from: string; to: string[]; subject: string | null; text: string; thread: string | null; hop: number; createdAt: number; senderPrincipal: string | null; verified: boolean; reason: string | null } | null> {
    const { unwrapEvent } = await import("nostr-tools/nip59");
    let rumor: ReturnType<typeof unwrapEvent>;
    try { rumor = unwrapEvent(opts.wrap as any, hexToBytes(opts.conn.sk)); } catch { return null; }
    if (rumor.kind !== 14 || typeof rumor.content !== "string" || !Array.isArray(rumor.tags)) return null;
    const tag = (n: string) => rumor.tags.find(t => t[0] === n)?.[1] ?? null;
    const from = String(tag("from") ?? "").toLowerCase();
    const msg = {
        id: rumor.id, from, to: rumor.tags.filter(t => t[0] === "to").map(t => String(t[1]).toLowerCase()), subject: tag("subject"),
        text: rumor.content, thread: rumor.tags.find(t => t[0] === "e" && t[3] === "root")?.[1] ?? null,
        hop: Math.max(0, Math.trunc(Number(tag("hop") ?? 0)) || 0), createdAt: rumor.created_at * 1000,
        senderPrincipal: null as string | null, verified: false, reason: null as string | null,
    };
    const owner = await ctx.fns.inbox.keyOwner({ conn: opts.conn, npub: rumor.pubkey });
    if (!owner) return { ...msg, reason: "sender key is not in the directory" };
    msg.senderPrincipal = owner.principal;
    const claimed = from ? await ctx.fns.inbox.lookup({ conn: opts.conn, addr: from }) : null;
    if (!claimed) return { ...msg, reason: "unknown from address" };
    if (claimed.principal !== owner.principal) return { ...msg, reason: `from ${from} is not the owner of the sender key (${owner.principal})` };
    return { ...msg, verified: true };
}
