/**
 * Draws a small label or count in a tone (neutral, info, success, warning, danger, accent); with an action it is a button.
 * @param opts.text Label text.
 * @param opts.tone Meaning. @default "neutral"
 * @param opts.action What a click does (open a popup with the details): the badge becomes a button.
 * @param opts.title Tooltip and accessible name of the button (what the label means and what a click does).
 * @param opts.marks Automation markers written as data-* (action, entity, id, status) — the w.marks keys.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Label text. */
    text: string | number;
    /** Meaning. @default "neutral" */
    tone?: types.w.Tone;
    /** What a click does (open a popup with the details): the badge becomes a button. */
    action?: types.w.Action;
    /** Tooltip and accessible name of the button (what the label means and what a click does). */
    title?: string;
    /** Automation markers written as data-* (action, entity, id, status) — the w.marks keys. */
    marks?: { action?: string; entity?: string; id?: string; status?: string };
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    const marks = opts.marks ? ` ${ctx.fns.w.marks(opts.marks)}` : "";
    const head = `class="w-badge" data-tone="${opts.tone ?? "neutral"}"${marks}`;
    if (!opts.action) return `<span ${head}${opts.title ? ` title="${esc(opts.title)}"` : ""}>${esc(opts.text)}</span>`;
    const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action });
    const t = tag === "div" ? "button" : tag;
    const name = opts.title ? ` title="${esc(opts.title)}" aria-label="${esc(opts.title)}"` : "";
    return `<${t} ${head}${name}${attrs || ' type="button"'}>${esc(opts.text)}</${t}>`;
}
