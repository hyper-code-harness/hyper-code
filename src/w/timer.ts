/**
 * Draws a live clock of how long something has been running — "12s" in a row, or "running 1:05 of 2:00" against
 * a deadline — counted in the browser (ui/tool-timer.js), so the server never re-renders it every second.
 * Past the deadline it turns the warning tone.
 * @param opts.since Start, milliseconds since epoch.
 * @param opts.deadline End the run is held to, ms since epoch; shows "of <limit>" and warns past it.
 * @param opts.format short "12s" / "3m 05s" for a row, clock "running 1:05" for a details view. @default "short"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Start, milliseconds since epoch. */
    since: number;
    /** End the run is held to, ms since epoch; shows "of <limit>" and warns past it. */
    deadline?: number;
    /** short "12s" / "3m 05s" for a row, clock "running 1:05" for a details view. @default "short" */
    format?: "short" | "clock";
}): string {
    const since = Number(opts.since) || 0;
    const deadline = Number(opts.deadline) > since ? Number(opts.deadline) : 0;
    const attrs = ctx.fns.w.hooks({ attrs: { "data-since": since, "data-deadline": deadline || undefined, "data-format": opts.format ?? "short" } });
    return `<span class="w-timer"${attrs}>…</span>`;
}
