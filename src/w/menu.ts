/**
 * Draws a menu of actions — the same menu for a button (any widget with action { popover: id } opens it, at that
 * widget) and for a right-click (contextOf: ui/hotkeys.js opens it at the pointer). Arrow keys, Home and End
 * move between items, Escape closes (one delegated handler in ui/hotkeys.js). Items can be dangerous, carry a
 * shortcut, and be split by separators.
 * @param opts.id Menu id (unique on the page).
 * @param opts.items Items; "-" is a separator.
 * @param opts.trigger Trusted HTML of the opener (a widget with action { popover: id }), drawn before the menu.
 * @param opts.label Accessible name.
 * @param opts.contextOf Selector of the element whose right-click opens this menu.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Menu id (unique on the page). */
    id: string;
    /** Items; "-" is a separator. */
    items: Array<"-" | { label: string; icon?: string; keys?: string; action?: types.w.Action; danger?: boolean }>;
    /** Trusted HTML of the opener (a widget with action { popover: id }), drawn before the menu. */
    trigger?: string;
    /** Accessible name. */
    label?: string;
    /** Selector of the element whose right-click opens this menu. */
    contextOf?: string;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const items = opts.items.map(it => {
        if (it === "-") return '<div class="w-menu-sep" role="separator"></div>';
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: it.action ?? { action: "noop" } });
        return `<${tag} class="w-menu-item" role="menuitem" tabindex="-1"${it.danger ? ' data-danger' : ""}${attrs}>${it.icon ? ctx.fns.w.icon({ name: it.icon, size: 16 }) : '<span class="w-menu-gap"></span>'}<span class="w-menu-label">${esc(it.label)}</span>${it.keys ? ctx.fns.w.kbd({ keys: it.keys }) : ""}</${tag}>`;
    }).join("");
    const id = String(opts.id).replace(/[^a-zA-Z0-9_-]/g, "-");
    return `${opts.trigger ?? ""}<div id="${id}" popover class="w-menu" role="menu" aria-label="${esc(opts.label ?? "Menu")}"${opts.contextOf ? ` data-context-of="${esc(opts.contextOf)}"` : ""} style="position-anchor:--${id}">${items}</div>`;
}
