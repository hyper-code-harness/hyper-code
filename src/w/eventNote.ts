/**
 * Draws a quiet line in the conversation for something that happened (stopped by user, context compacted,
 * woke up, model changed), optionally with a fold-out of details.
 * @param opts.text What happened.
 * @param opts.icon Phosphor icon before it.
 * @param opts.details Trusted HTML shown when unfolded.
 * @param opts.ts When, ms since epoch.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What happened. */
    text: string;
    /** Phosphor icon before it. */
    icon?: string;
    /** Trusted HTML shown when unfolded. */
    details?: string;
    /** When, ms since epoch. */
    ts?: number;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const line = `${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 12 }) : ""}<span>${esc(opts.text)}</span>${opts.ts ? ctx.fns.w.time({ ts: opts.ts }) : ""}`;
    return opts.details
        ? `<details class="w-note"><summary>${line}</summary><div class="w-note-details">${opts.details}</div></details>`
        : `<div class="w-note" role="status">${line}</div>`;
}
