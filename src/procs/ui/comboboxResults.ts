// The rows a combobox's results endpoint returns for `?q=<typed>`: one option per
// item, or a "no matches" line. Two shapes, chosen per item:
//   • no `href` → a pick button that htmx-swaps the whole widget (`closest
//     [data-field]`) for the chosen state (`?pick=`) — a form field.
//   • `href` set → a link that navigates `#main` to it (same swap as a list row),
//     for a type-ahead that jumps somewhere (e.g. a patient).
// Either way the row is a `[role=option]` the kit's `$script_combobox` drives with
// arrow-keys/Enter. An app endpoint filters its own data and hands the hits here,
// so the markup stays one shape across every combobox.
/**
 * Perform combobox results for the ui subsystem.
 * @param opts.name The target name.
 * @param opts.url The target URL.
 * @param opts.items Matching options rendered as field selections or navigation links.
 */
export default function (ctx: Context, _session: Session | null, opts: { name: string; url: string; items: Array<{ value: string; label: string; hint?: string; href?: string }> }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    if (!opts.items.length) return `<div class="px-3 py-2 text-xs text-subtle">no matches</div>`;
    const cls = "flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm text-base-content hover:bg-base-200";
    return opts.items.map(o => {
        const inside = `<span class="min-w-0 truncate">${esc(o.label)}</span>${o.hint ? `<span class="ml-2 shrink-0 text-xs text-subtle">${esc(o.hint)}</span>` : ""}`;
        return ctx.fns.procs.ui.button({
            action: "pick", id: o.value, html: inside, href: o.href,
            get: o.href ? undefined : `${opts.url}?pick=${encodeURIComponent(o.value)}&name=${encodeURIComponent(opts.name)}`,
            target: o.href ? "#main" : "closest [data-field]", swap: o.href ? "innerHTML" : "outerHTML",
            appearance: "plain", class: `${o.href ? "ui-focusable " : ""}${cls}`,
            attrs: { role: "option", ...(o.href ? { "hx-push-url": "true" } : {}) },
        });
    }).join("");
}
