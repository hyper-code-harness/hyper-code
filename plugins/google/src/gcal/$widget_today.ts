// Widget for the global menu (⌘/): today's events across every authorized Google calendar.
// Cached for a few minutes so opening the menu does not call Google every time.
export default {
    title: "Today",
    icon: "ph-calendar-blank",
    description: "Today's events across your Google calendars",
    sizes: ["M", "S", "wide", "tall"],
    config: { days: { type: "number", default: 1, description: "How many days ahead to show, starting today" } },
    ttl: 300,
    async render(ctx: Context, _session: Session | null, opts: { size: types.nav.Size; config: Record<string, unknown> }): Promise<types.nav.WidgetOutput> {
        const days = Math.max(1, Math.min(7, Number(opts.config.days ?? 1) || 1));
        const start = new Date();
        start.setHours(0, 0, 0, 0);
        const end = new Date(start.getTime() + days * 86_400_000);
        const { events } = await ctx.fns.gcal.agenda({ from: start.toISOString(), to: end.toISOString() });
        const now = Date.now();
        const time = new Intl.DateTimeFormat("ru-RU", { hour: "2-digit", minute: "2-digit" });
        const day = new Intl.DateTimeFormat("ru-RU", { weekday: "short", day: "numeric" });
        const max = opts.size === "S" ? 3 : opts.size === "tall" ? 30 : 6;
        const items = events
            .filter(e => e.allDay || new Date(e.end).getTime() > now)
            .sort((a, b) => a.start.localeCompare(b.start))
            .slice(0, max)
            .map((e): types.nav.Item => {
                const at = new Date(e.start);
                const when = e.allDay ? "all day" : time.format(at);
                return {
                    id: `gcal:${e.calendarId}/${e.id}`,
                    label: e.summary || "(no title)",
                    href: e.htmlLink && /^https:\/\//.test(e.htmlLink) ? e.htmlLink : "/gcal/",
                    icon: e.meetLink ? "ph-video-camera" : "ph-calendar-dot",
                    hint: days > 1 ? `${day.format(at)} ${when}` : when,
                };
            });
        return items.length ? { items } : { html: `<a href="/gcal/" class="nav-row flex items-center gap-2 rounded px-2 py-1 text-xs text-faint hover:bg-base-200/60">Nothing more today</a>` };
    },
} satisfies types.nav.Widget;
