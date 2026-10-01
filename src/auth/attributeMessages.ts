/**
 * Prefixes human messages in an outgoing LLM transcript with their author: "<Name>: text".
 *
 * Works on a copy for one provider request; stored messages are never changed. Applies only when
 * the instance has more than one active user, so a single-user transcript stays byte-identical and
 * prompt caches are kept. Every human message with a recorded author is prefixed, including the
 * chat owner's; messages written before users existed (no author) are left as they are.
 * Structured content (images, documents) gets the prefix on its first text part, or a new one.
 * Messages authored by another agent (`agent:<id>`) are never prefixed: agent.message already
 * stores them inside an `<agent-message from=...>` envelope that names the sender.
 * @param opts.messages Outgoing provider-neutral messages (role, content, author).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Outgoing provider-neutral messages (role, content, author). */
        messages: any[];
    },
): Promise<{ messages: any[]; applied: boolean }> {
    const users = await ctx.fns.auth.listUsers({ includeDisabled: true });
    if (users.filter((u) => u.disabledAt == null).length < 2) return { messages: opts.messages, applied: false };
    const names = new Map(users.map((u) => [u.id, u.name]));
    const messages = opts.messages.map((m: any) => {
        if (m?.role !== "user" || !m.author || m.excluded_from_cursor || String(m.author).startsWith("agent:")) return m;
        const prefix = `<${names.get(m.author) ?? m.author}>: `;
        if (typeof m.content === "string") return { ...m, content: prefix + m.content };
        if (Array.isArray(m.content)) {
            const parts = [...m.content];
            const at = parts.findIndex((p: any) => p?.type === "text");
            if (at >= 0) parts[at] = { ...parts[at], text: prefix + String(parts[at].text ?? "") };
            else parts.unshift({ type: "text", text: prefix.trimEnd() });
            return { ...m, content: parts };
        }
        return m;
    });
    return { messages, applied: true };
}
