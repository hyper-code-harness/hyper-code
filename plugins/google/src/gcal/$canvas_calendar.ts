// Google Calendar as a canvas tab (kind gcal.calendar): the live /gcal page in embed mode, merged across
// every authorized account. Tab state { date } is the day on screen; the page reports clicks into it
// and follows state the agent sets.

export const hint = "one day of the person's Google Calendar (own calendars of all accounts, live), each event with details — args `{ date?: \"YYYY-MM-DD\" }` (default today)";

export default {
    view: "gcal.dayPage",
    icon: "calendar-blank",
    live: true,
    liveState: true,
    prepare(_ctx: Context, opts: { agentId: string; args: Record<string, any> }) {
        const date = /^\d{4}-\d{2}-\d{2}$/.test(String(opts.args.date ?? "")) ? String(opts.args.date) : undefined;
        return { args: date ? { date } : {}, title: "Calendar" };
    },
    render(ctx: Context, opts: { agentId: string; item: types.canvas.Item }) {
        const s = { ...opts.item.args, ...opts.item.state };
        const p = new URLSearchParams({ embed: "1" });
        if (s.date) p.set("date", String(s.date));
        const esc = (text: string) => ctx.fns.procs.ui.escape({ text });
        return `<iframe data-canvas-frame="${opts.item.id}" src="/gcal/?${esc(p.toString())}" title="${esc(opts.item.title)}" class="block h-full w-full border-0 bg-base-100" loading="eager"></iframe>`;
    },
    describe(_ctx: Context, opts: { item: types.canvas.Item }) {
        const s = { ...opts.item.args, ...opts.item.state };
        return `Google Calendar day ${s.date ?? "(today)"} — same data: gcal.agenda({ from, to })`;
    },
} satisfies types.canvas.Kind;
