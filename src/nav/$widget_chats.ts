// Core widget: New agent, the viewer's unread @mentions and recent chats — the first column of the menu.
export default {
    title: "Chats",
    icon: "ph-chats-circle",
    description: "New agent, unread mentions and the most recent chats",
    sizes: ["tall", "L", "M"],
    config: { limit: { type: "number", default: 50, description: "How many recent chats to list" } },
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }): Promise<types.nav.WidgetOutput> {
        const limit = Math.max(1, Math.min(200, Number(opts.config.limit ?? 50) || 50));
        const [agents, mentions] = await Promise.all([
            ctx.fns.nav.agents({ limit }).catch(() => [] as any[]),
            ctx.fns.mentions.list({ unreadOnly: true, limit: 10 }).catch(() => []),
        ]);
        const chatItems = await ctx.fns.nav.chatItems({ agents });
        const newAgent = `<section class="mb-3 border-b border-ui-border pb-2"><a href="/agent/new" data-nav-default class="nav-row mb-1 flex min-h-10 items-center gap-2 rounded-lg border border-primary bg-primary/10 px-3 py-2 text-left text-primary shadow-sm outline-none transition hover:bg-primary/15 focus:bg-primary/15"><i class="ph ph-plus-circle shrink-0 text-lg" aria-hidden="true"></i><span class="min-w-0 flex-1 text-xs font-medium">New agent</span></a></section>`;
        const mentionsHtml = mentions.length ? await ctx.fns.mentions.rowsHtml({ items: mentions, navRow: true }) : "";
        return {
            html: newAgent,
            sections: [
                ...(mentions.length ? [{ title: `Mentions · ${mentions.length}`, html: mentionsHtml, tone: "primary" as const }] : []),
                { title: "Recent", items: chatItems },
            ],
        };
    },
} satisfies types.nav.Widget;
