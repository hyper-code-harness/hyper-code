/**
 * Turns a widget Action into the attributes of the clickable element (href, hx-post/hx-get/hx-vals, hx-popup,
 * popovertarget, data-action, hx-confirm) and says which element to use.
 *
 * Every clickable widget of the set goes through this, so an action reads the same everywhere and the
 * attribute rules (escaping, swap none for posts, local hrefs only) live in one place.
 * @param opts.action What the element does; omit for a non-interactive element.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What the element does; omit for a non-interactive element. */
    action?: types.w.Action;
}): { tag: "a" | "button" | "span"; attrs: string } {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const a = opts.action;
    if (!a) return { tag: "span", attrs: "" };
    const confirm = a.confirm ? ` hx-confirm="${esc(a.confirm)}"` : "";
    if (a.href !== undefined) {
        const href = String(a.href);
        const safe = href.startsWith("/") || href.startsWith("#") || /^https?:\/\//.test(href) ? href : "#";
        return { tag: "a", attrs: ` href="${esc(safe)}"${/^https?:\/\//.test(safe) ? ' target="_blank" rel="noopener"' : ""}` };
    }
    const vals = a.vals ? ` hx-vals="${esc(JSON.stringify(a.vals))}"` : "";
    if (a.post) return { tag: "button", attrs: ` type="button" hx-post="${esc(a.post)}"${vals} hx-swap="none" hx-target="this"${confirm}` };
    if (a.get) return { tag: "button", attrs: ` type="button" hx-get="${esc(a.get)}"${vals} hx-target="${esc(a.target ?? "this")}"${confirm}` };
    if (a.popup) return { tag: "button", attrs: ` type="button" hx-popup="${esc(a.popup.method)}" hx-popup-params="${esc(JSON.stringify(a.popup.params ?? {}))}"` };
    if (a.popover) return { tag: "button", attrs: ` type="button" popovertarget="${esc(a.popover)}"` };
    if (a.action) return { tag: "button", attrs: ` type="button" data-action="${esc(a.action)}"` };
    return { tag: "button", attrs: ' type="button"' };
}
