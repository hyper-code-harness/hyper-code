/**
 * Draws a quiet line in the conversation for something that happened (stopped by user, context compacted,
 * woke up, a goal check, a delegated agent finished), with an optional badge, a short body under the line,
 * a fold-out of details, and a link to where it happened.
 * @param opts.text What happened.
 * @param opts.icon Phosphor icon before it.
 * @param opts.tone Meaning, shown on the icon and the badge.
 * @param opts.badge Short status after the text (w.badge in the same tone).
 * @param opts.body Trusted HTML always shown under the line (a reason, a button).
 * @param opts.details Trusted HTML shown when unfolded.
 * @param opts.href The line is a link to this local path (the agent it is about).
 * @param opts.ts When, ms since epoch.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What happened. */
    text: string;
    /** Phosphor icon before it. */
    icon?: string;
    /** Meaning, shown on the icon and the badge. */
    tone?: types.w.Tone;
    /** Short status after the text (w.badge in the same tone). */
    badge?: string;
    /** Trusted HTML always shown under the line (a reason, a button). */
    body?: string;
    /** Trusted HTML shown when unfolded. */
    details?: string;
    /** The line is a link to this local path (the agent it is about). */
    href?: string;
    /** When, ms since epoch. */
    ts?: number;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const href = opts.href ? ctx.fns.w.safeUrl({ url: opts.href }) : "";
    const text = href ? `<a class="w-note-text" href="${esc(href)}">${esc(opts.text)}</a>` : `<span class="w-note-text">${esc(opts.text)}</span>`;
    const line = `${opts.icon ? ctx.fns.w.icon({ name: opts.icon, size: 12 }) : ""}${text}`
        + `${opts.badge ? ctx.fns.w.badge({ text: opts.badge, tone: opts.tone }) : ""}${opts.ts ? ctx.fns.w.time({ ts: opts.ts }) : ""}`;
    const tone = opts.tone ? ` data-tone="${opts.tone}"` : "";
    const body = opts.body ? `<div class="w-note-body">${opts.body}</div>` : "";
    return opts.details
        ? `<details class="w-note"${tone}><summary>${line}</summary>${body}<div class="w-note-details">${opts.details}</div></details>`
        : `<div class="w-note"${tone} role="status"><div class="w-note-line">${line}</div>${body}</div>`;
}
