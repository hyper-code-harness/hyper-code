/**
 * Draws a moment as a clock time (13:48), a date, or "3 min ago", with the full date in the tooltip.
 * @param opts.ts Milliseconds since epoch.
 * @param opts.format How to show it. @default "clock"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Milliseconds since epoch. */
    ts: number;
    /** How to show it. @default "clock" */
    format?: "clock" | "date" | "ago";
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const d = new Date(Number(opts.ts));
    if (Number.isNaN(d.getTime())) return "";
    const full = d.toLocaleString("en-GB", { day: "numeric", month: "short", year: "numeric", hour: "2-digit", minute: "2-digit" });
    let text: string;
    if (opts.format === "date") text = d.toLocaleDateString("en-GB", { day: "numeric", month: "short" });
    else if (opts.format === "ago") {
        const s = Math.max(0, Math.round((Date.now() - d.getTime()) / 1000));
        text = s < 60 ? "just now" : s < 3600 ? `${Math.floor(s / 60)} min ago` : s < 86400 ? `${Math.floor(s / 3600)} h ago` : `${Math.floor(s / 86400)} d ago`;
    } else text = d.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" });
    return `<time class="w-time" datetime="${d.toISOString()}" title="${esc(full)}">${esc(text)}</time>`;
}
