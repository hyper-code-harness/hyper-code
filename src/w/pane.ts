/**
 * Draws a pane: a paneHeader, a scrolling body and an optional footer, on one of the three surfaces —
 * chrome (bars, panels), chat (the conversation) or document (white: canvas pages, editors).
 * @param opts.header Trusted header HTML, usually w.paneHeader.
 * @param opts.body Trusted body HTML.
 * @param opts.footer Trusted footer HTML (a composer, a status line).
 * @param opts.surface Background of the body. @default "document"
 * @param opts.id DOM id of the pane.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Trusted header HTML, usually w.paneHeader. */
    header?: string;
    /** Trusted body HTML. */
    body: string;
    /** Trusted footer HTML (a composer, a status line). */
    footer?: string;
    /** Background of the body. @default "document" */
    surface?: "chrome" | "chat" | "document";
    /** DOM id of the pane. */
    id?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    return `<section class="w-pane" data-surface="${opts.surface ?? "document"}"${opts.id ? ` id="${esc(opts.id)}"` : ""}>${opts.header ?? ""}<div class="w-pane-body">${opts.body}</div>${opts.footer ? `<footer class="w-pane-footer">${opts.footer}</footer>` : ""}</section>`;
}
