/**
 * Draws a menu of actions — the same menu for a button (it opens in a popover) and for a right-click on
 * something (contextOf: ui/hotkeys.js opens it at the pointer). Items can be dangerous, carry a shortcut,
 * and be split by separators.
 * @param opts.id Menu id (unique on the page).
 * @param opts.items Items; "-" is a separator.
 * @param opts.trigger Trusted HTML of the button that opens it; omit for a context menu.
 * @param opts.label Accessible name.
 * @param opts.contextOf Selector of the element whose right-click opens this menu.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Menu id (unique on the page). */
    id: string;
    /** Items; "-" is a separator. */
    items: Array<"-" | { label: string; icon?: string; keys?: string; action?: types.w.Action; danger?: boolean }>;
    /** Trusted HTML of the button that opens it; omit for a context menu. */
    trigger?: string;
    /** Accessible name. */
    label?: string;
    /** Selector of the element whose right-click opens this menu. */
    contextOf?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const items = opts.items.map(it => {
        if (it === "-") return '<div class="w-menu-sep" role="separator"></div>';
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: it.action ?? {} });
        const t = tag === "span" ? "button" : tag;
        return `<${t} class="w-menu-item" role="menuitem"${it.danger ? ' data-tone="danger"' : ""}${attrs || ' type="button"'}>${it.icon ? ctx.fns.w.icon({ name: it.icon, size: 16 }) : '<span class="w-menu-gap"></span>'}<span class="w-menu-label">${esc(it.label)}</span>${it.keys ? ctx.fns.w.kbd({ keys: it.keys }) : ""}</${t}>`;
    }).join("");
    const id = String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    const panel = `<div id="${id}" popover class="w-menu" role="menu" aria-label="${esc(opts.label ?? "Menu")}"${opts.contextOf ? ` data-context-of="${esc(opts.contextOf)}"` : ""} style="position-anchor:--${id}">${items}</div>`;
    if (!opts.trigger) return panel;
    return `<button type="button" class="w-popover-trigger" popovertarget="${id}" style="anchor-name:--${id}" aria-label="${esc(opts.label ?? "Menu")}">${opts.trigger}</button>${panel}`;
}
