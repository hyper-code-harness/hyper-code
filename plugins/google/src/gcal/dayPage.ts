/**
 * Shows one day of the person's Google Calendar (own calendars of every authorized account, each event with its
 * details) as a page.
 *
 * Use for an address of a day: `/rpc/gcal.dayPage?{"date":"2026-05-14"}` (no date = today) — a canvas view tab
 * (what the `gcal.calendar` kind opens), a chat link or a browser tab. The day runs in its own frame (the /gcal
 * page in embed mode); in a canvas tab ‹ › and Today move the tab to that day's address, so ◀ ▶ step through
 * the days seen. The same data as text: gcal.agenda({ from, to }).
 * @view
 * @param opts.date Day to show as YYYY-MM-DD; omit for today.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Day to show as YYYY-MM-DD; omit for today. */
    date?: string;
}): Promise<string> {
    const q = new URLSearchParams({ embed: "1" });
    if (opts.date !== undefined && opts.date !== "") {
        if (!/^\d{4}-\d{2}-\d{2}$/.test(String(opts.date))) throw new Error(`gcal.dayPage: date must be YYYY-MM-DD, got ${opts.date}`);
        q.set("date", String(opts.date));
    }
    return ctx.fns.rpc.frame({ src: `/gcal/?${q}`, title: "Calendar" });
}
