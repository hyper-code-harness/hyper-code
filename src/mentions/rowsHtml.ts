/**
 * Renders mention rows as links to the mentioning message: author, chat title, time and a line of text.
 *
 * Shared by the left-rail popup and the global menu. Links go to /agent/<chat>#m-<message index>.
 * @param opts.items Mentions from mentions.list.
 * @param opts.navRow Mark rows as global-menu rows (keyboard navigable).
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Mentions from mentions.list. */
        items: Array<{ id: number; agentId: string; agentTitle: string | null; messageIdx: number; from: string | null; excerpt: string; createdAt: number; readAt: number | null }>;
        /** Mark rows as global-menu rows (keyboard navigable). @default false */
        navRow?: boolean;
    },
): Promise<string> {
    if (!opts.items.length) return ctx.fns.w.empty({ title: "No mentions", icon: "at" });
    const people = new Map((await ctx.fns.mentions.people({})).map((p) => [p.id, p.name]));
    const who = (from: string | null) => !from ? "someone" : from.startsWith("agent:") ? `agent ${from.slice(6)}` : people.get(from) ?? from;
    const time = (ts: number) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
    return opts.items.map((m) => ctx.fns.w.listRow({
        label: `${who(m.from)} in ${m.agentTitle || m.agentId}`,
        detail: m.excerpt,
        icon: "at",
        hint: time(m.createdAt),
        dot: m.readAt ? undefined : "unread",
        action: { href: `/agent/${encodeURIComponent(m.agentId)}#m-${m.messageIdx}` },
        attrs: opts.navRow ? { "data-nav-row": true, "data-nav-id": `mention:${m.id}` } : undefined,
    })).join("");
}
