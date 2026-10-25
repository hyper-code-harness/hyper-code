/**
 * Draws a small state dot — running and unread (blue), waiting for the person (the super accent), done, warning,
 * error or idle — with an optional label.
 * @param opts.state What the dot says.
 * @param opts.label Text after the dot; also the accessible name.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What the dot says. */
    state: "idle" | "running" | "unread" | "waiting" | "done" | "warning" | "error";
    /** Text after the dot; also the accessible name. */
    label?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const dot = `<span class="w-dot" data-state="${esc(opts.state)}"${opts.label ? "" : ` role="img" aria-label="${esc(opts.state)}"`}></span>`;
    return opts.label ? `<span class="w-dot-label">${dot}<span>${esc(opts.label)}</span></span>` : dot;
}
