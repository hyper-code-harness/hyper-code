/**
 * Draws one entry of a skills list: a title line, a description that wraps, and a quiet line of facts under it
 *
 * Use on the Skills pages instead of a table row: a table with one long description column runs off a narrow canvas,
 * a list entry wraps inside whatever width it has. Entries placed one after another are ruled between. All parts are
 * trusted HTML built by the caller.
 * @param opts.title Trusted HTML of the first line: usually a link, then badges.
 * @param opts.text Trusted HTML of the description; wraps, never scrolls sideways.
 * @param opts.meta Trusted HTML of the quiet line under the description.
 */
export default function (_ctx: Context, _session: Session | null, opts: {
    /** Trusted HTML of the first line: usually a link, then badges. */
    title: string;
    /** Trusted HTML of the description; wraps, never scrolls sideways. */
    text?: string;
    /** Trusted HTML of the quiet line under the description. */
    meta?: string;
}): string {
    const wrap = "min-width:0;overflow-wrap:anywhere;word-break:break-word";
    return `<div style="padding:var(--w-s2) 0;border-bottom:var(--w-rule);${wrap}">`
        + `<div style="display:flex;flex-wrap:wrap;align-items:center;gap:var(--w-s1) var(--w-s2);font-weight:500">${opts.title}</div>`
        + (opts.text ? `<div style="margin-top:2px;${wrap}">${opts.text}</div>` : "")
        + (opts.meta ? `<div style="margin-top:2px;font-size:var(--w-text-small);color:var(--w-ink-faint);${wrap}">${opts.meta}</div>` : "")
        + `</div>`;
}
