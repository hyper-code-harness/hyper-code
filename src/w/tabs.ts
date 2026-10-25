/**
 * Draws a tab strip: equal-width tabs that fill a header row (the canvas) or an underlined strip (pages).
 * Each tab can carry an icon, a count and a close button.
 * @param opts.items The tabs, in order.
 * @param opts.active Id of the open tab.
 * @param opts.variant Look of the strip. @default "equal"
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The tabs, in order. */
    items: Array<{ id: string; label: string; icon?: string; count?: number; action?: types.w.Action; close?: types.w.Action }>;
    /** Id of the open tab. */
    active?: string;
    /** Look of the strip. @default "equal" */
    variant?: "equal" | "underline";
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const tabs = (opts.items ?? []).map(it => {
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: it.action ?? {} });
        const t = tag === "span" ? "button" : tag;
        const close = it.close ? (() => { const c = ctx.fns.w.actionAttrs({ action: it.close }); return `<button class="w-tab-close" title="Close" aria-label="Close ${esc(it.label)}"${c.attrs || ' type="button"'}>${ctx.fns.w.icon({ name: "x", size: 12 })}</button>`; })() : "";
        return `<span class="w-tab"${it.id === opts.active ? ' aria-current="true"' : ""}><${t} class="w-tab-main" title="${esc(it.label)}"${attrs || ' type="button"'}>${it.icon ? ctx.fns.w.icon({ name: it.icon, size: 14 }) : ""}<span class="w-tab-label">${esc(it.label)}</span>${it.count ? `<span class="w-tab-count">${it.count}</span>` : ""}</${t}>${close}</span>`;
    }).join("");
    return `<nav class="w-tabs" data-variant="${opts.variant ?? "equal"}" role="tablist">${tabs}</nav>`;
}
