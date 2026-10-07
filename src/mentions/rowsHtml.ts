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
    const esc = (v: any) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    if (!opts.items.length) return '<div class="px-2 py-2 text-xs text-faint">no mentions</div>';
    const people = new Map((await ctx.fns.mentions.people({})).map((p) => [p.id, p.name]));
    const who = (from: string | null) => !from ? "someone" : from.startsWith("agent:") ? `agent ${from.slice(6)}` : people.get(from) ?? from;
    const time = (ts: number) => new Intl.DateTimeFormat("ru-RU", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(ts));
    return opts.items.map((m) => `<a href="/agent/${encodeURIComponent(m.agentId)}#m-${m.messageIdx}" class="${opts.navRow ? "nav-row " : ""}flex items-start gap-2 rounded px-2 py-1.5 text-left outline-none hover:bg-base-200/60">`
        + `<i class="ph ph-at mt-0.5 shrink-0 ${m.readAt ? "text-faint" : "text-primary"}" aria-hidden="true"></i>`
        + `<span class="min-w-0 flex-1"><span class="flex gap-1 text-xs"><span class="truncate font-medium">${esc(who(m.from))}</span><span class="truncate text-faint">in ${esc(m.agentTitle || m.agentId)}</span><span class="ml-auto shrink-0 text-3xs text-faint">${esc(time(m.createdAt))}</span></span>`
        + `<span class="line-clamp-2 block text-3xs text-muted">${esc(m.excerpt)}</span></span></a>`).join("");
}
