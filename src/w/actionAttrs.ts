/**
 * Turns a widget Action into the attributes of the clickable element and says which element to use: a link
 * (href, checked by w.safeUrl), or a button with hx-post/hx-get (explicit target and swap), hx-popup,
 * popovertarget (plus anchor-name, aria-haspopup and aria-controls, so the popover opens at the element) or
 * data-action. A confirm applies to every kind. An action with no kind or with two kinds throws — it is a bug in
 * the caller, not something to guess.
 * @param opts.action What the element does; omit for a non-interactive element.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What the element does; omit for a non-interactive element. */
    action?: types.w.Action;
}): { tag: "a" | "button" | "div"; attrs: string } {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const a = opts.action;
    if (!a) return { tag: "div", attrs: "" };
    const kinds = (["href", "post", "get", "popup", "popover", "action"] as const).filter(k => a[k] !== undefined && a[k] !== "");
    if (kinds.length !== 1) throw new Error(`w.Action needs exactly one of href, post, get, popup, popover, action — got ${kinds.join(", ") || "none"}`);
    const confirm = a.confirm ? ` hx-confirm="${esc(a.confirm)}"` : "";
    const vals = (a.vals ? ` hx-vals="${esc(JSON.stringify(a.vals))}"` : "") + (a.push && (a.get || a.post) ? ` hx-push-url="${esc(a.push)}"` : "");
    if (a.href !== undefined) {
        const url = ctx.fns.w.safeUrl({ url: a.href });
        if (!url) return { tag: "div", attrs: ' aria-disabled="true"' };
        return { tag: "a", attrs: ` href="${esc(url)}"${/^https?:\/\//i.test(url) ? ' target="_blank" rel="noopener"' : ""}${confirm ? ` hx-boost="true"${confirm}` : ""}` };
    }
    if (a.post) return { tag: "button", attrs: ` type="button" hx-post="${esc(a.post)}"${vals} hx-target="${esc(a.target ?? "this")}" hx-swap="${a.swap ?? "none"}"${confirm}` };
    if (a.get) {
        if (!a.target) throw new Error("w.Action get needs a target (where the answer goes)");
        return { tag: "button", attrs: ` type="button" hx-get="${esc(a.get)}"${vals} hx-target="${esc(a.target)}" hx-swap="${a.swap ?? "innerHTML"}"${confirm}` };
    }
    if (a.popup) return { tag: "button", attrs: ` type="button" hx-popup="${esc(a.popup.method)}" hx-popup-params="${esc(JSON.stringify(a.popup.params ?? {}))}"${confirm}` };
    if (a.popover) {
        const id = String(a.popover).replace(/[^a-zA-Z0-9_-]/g, "-");
        return { tag: "button", attrs: ` type="button" popovertarget="${id}" style="anchor-name:--${id}" aria-haspopup="true" aria-controls="${id}" aria-expanded="false"` };
    }
    return { tag: "button", attrs: ` type="button" data-action="${esc(a.action)}"${confirm}` };
}
