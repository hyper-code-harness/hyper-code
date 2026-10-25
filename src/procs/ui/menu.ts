// A dropdown of actions — a row's kebab, a "more" button. A <details> disclosure
// with an absolutely-positioned panel: no client JS, and it closes on its own
// because every item navigates or posts (the pane re-renders, the menu is gone).
// Each item is an action (data-action), a link, or an htmx post.
/**
 * Perform menu for the ui subsystem.
 * @param opts.id The target identifier.
 * @param opts.label The display label.
 * @param opts.icon Optional Phosphor icon class for the disclosure trigger.
 * @param opts.items Menu actions or links with optional icons and htmx request details.
 * @param opts.align Horizontal edge used to align the dropdown panel.
 * @param opts.class CSS classes to apply.
 * @deprecated use w.menu
 */
export default function (ctx: Context, _session: Session | null, opts: {id?: string; label?: string; icon?: string; items: Array<{ label: string; icon?: string; href?: string; action?: string; post?: string; get?: string; vals?: Record<string, any>; danger?: boolean }>; align?: "left" | "right"; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    // the shared component layer's `dropdown` on a <details>, with `menu` inside it — the panel,
    // the hover states and the item padding are the component's.
    const item = (it: (typeof opts.items)[number]) => {
        const icon = it.icon ? `<i class="ph ${esc(it.icon)} w-4 opacity-60" aria-hidden="true"></i>` : "";
        const inner = ctx.fns.procs.ui.button({
            action: it.action, html: `${icon}${esc(it.label)}`, href: it.href,
            post: it.post, get: it.get, vals: it.vals, tone: it.danger ? "danger" : "ghost",
            appearance: "plain", class: it.danger ? "text-error" : "",
            attrs: { role: "menuitem", ...(it.href ? { "hx-push-url": "true" } : {}) },
        });
        return `<li>${inner}</li>`;
    };
    const trigger = opts.label || opts.icon
        ? `${opts.icon ? `<i class="ph ${esc(opts.icon)}" aria-hidden="true"></i>` : ""}${opts.label ? `<span>${esc(opts.label)}</span>` : ""}`
        : `<i class="ph ph-dots-three" aria-hidden="true"></i>`;
    const triggerButton = ctx.fns.procs.ui.button({
        element: "summary", action: "menu", html: trigger, tone: "ghost", size: "xs",
        attrs: { "aria-haspopup": "menu" },
    });
    return `<details class="dropdown ${opts.align === "left" ? "" : "dropdown-end"} ${opts.class ?? ""}" ${ctx.fns.procs.ui.attr({ entity: "menu", id: opts.id })}>
  ${triggerButton}
  <ul class="menu dropdown-content border border-ui-border bg-base-100 text-base-content rounded-box z-50 mt-1 w-52 p-2 shadow-lg" role="menu">${opts.items.map(item).join("")}</ul>
</details>`;
}
