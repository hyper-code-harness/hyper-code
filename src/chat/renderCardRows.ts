/**
 * Draws the action lines of a chat panel card: links, popups and confirmed POST forms, all the same height.
 * @param opts.rows Rows returned by a card's render.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Rows returned by a card's render. */
        rows: types.chat.CardRow[];
    },
): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const base = "chat-row flex w-full min-w-0 items-center gap-2 rounded-md px-2 py-1 text-left text-xs";
    return opts.rows.map(row => {
        const icon = row.icon && /^ph-[a-z0-9-]+$/.test(row.icon) ? `<i class="ph ${esc(row.icon)} shrink-0 text-sm" aria-hidden="true"></i>` : "";
        const hint = row.hint ? `<span class="ml-auto max-w-[45%] shrink-0 truncate font-mono text-3xs text-faint" title="${esc(row.hint)}">${esc(row.hint)}</span>` : "";
        const face = `${icon}<span class="min-w-0 truncate">${esc(row.label)}</span>${hint}`;
        const tone = row.tone === "danger" ? "text-error hover:bg-error/10" : "text-muted hover:bg-base-200 hover:text-base-content";
        if (row.popup?.method) return ctx.fns.ui.popup({ method: row.popup.method, params: row.popup.params ?? {}, html: face, attrs: `class="${base} ${tone}" title="${esc(row.label)}"` });
        if (row.href) return `<a href="${esc(row.href)}" class="${base} ${tone}">${face}</a>`;
        if (row.popovertarget) return `<button type="button" popovertarget="${esc(row.popovertarget)}" class="${base} ${tone}">${face}</button>`;
        if (row.post && row.vals) {
            const confirm = row.confirm ? ` hx-confirm="${esc(row.confirm)}"` : "";
            return `<button type="button" class="${base} ${tone}" hx-post="${esc(row.post)}" hx-vals="${esc(JSON.stringify(row.vals))}" hx-swap="none" hx-target="this"${confirm}>${face}</button>`;
        }
        if (row.post) {
            const confirm = row.confirm ? ` onsubmit="return confirm(${esc(JSON.stringify(row.confirm))})"` : "";
            return `<form method="POST" action="${esc(row.post)}" hx-boost="false"${confirm}><button type="submit" class="${base} ${tone}">${face}</button></form>`;
        }
        return `<div class="${base} text-faint">${face}</div>`;
    }).join("");
}
