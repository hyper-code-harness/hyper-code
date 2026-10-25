/**
 * Draws one chat header badge or button from an item description, so every plugin's element looks the same.
 *
 * An item with `popup` opens that runtime function in the app popup, with `href` it is a link, otherwise a
 * plain mark. Badges are small text pills; buttons are round icon buttons with an optional label.
 * @param opts.id Part id, kept on the element for automation.
 * @param opts.item The item returned by the part's render.
 * @param opts.side badge (left of the header) or button (right).
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Part id, kept on the element for automation. */
        id: string;
        /** The item returned by the part's render. */
        item: types.chat.Item;
        /** badge (left of the header) or button (right). */
        side: "badge" | "button";
    },
): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const c = opts.item;
    const icon = /^ph-[a-z0-9-]+$/.test(String(c.icon ?? "")) ? c.icon : "ph-circle";
    const title = String(c.title ?? c.label ?? opts.id);
    const tone = c.tone === "warning" ? "text-warning" : c.tone === "primary" ? "text-primary" : c.tone === "danger" ? "text-error" : "";
    const label = c.label ? `<span class="max-w-40 truncate${opts.side === "button" ? " hidden sm:inline" : ""}">${esc(c.label)}</span>` : "";
    const face = `<i class="ph ${esc(icon)} shrink-0${c.label ? "" : " text-lg"}" aria-hidden="true"></i>${label}`;
    const cls = opts.side === "badge"
        ? `inline-flex min-w-0 items-center gap-1 rounded-full px-1.5 py-0.5 text-micro leading-none text-faint transition hover:bg-base-100/50 hover:text-primary ${tone}`
        : `inline-flex h-7 ${c.label ? "px-2" : "w-7 justify-center"} items-center gap-1 rounded-full text-3xs font-medium text-subtle transition hover:bg-base-200 hover:text-base-content ${tone}`;
    const attrs = `class="${cls}" title="${esc(title)}" aria-label="${esc(title)}" data-chat-part="${esc(opts.id)}"`;
    if (c.popup?.method) return ctx.fns.ui.popup({ method: c.popup.method, params: c.popup.params ?? {}, html: face, attrs });
    if (c.href) return `<a href="${esc(c.href)}" ${attrs}>${face}</a>`;
    return `<span ${attrs}>${face}</span>`;
}
