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
    // Navigation tabs (each opens a page or a canvas tab): a nav of links/buttons with aria-current on the open one —
    // not role="tablist", which promises arrow-key tab panels these strips do not have.
    const tabs = (opts.items ?? []).map(it => {
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: it.action ?? { action: "select-tab" } });
        const close = it.close ? (() => { const c = ctx.fns.w.actionAttrs({ action: it.close }); return `<${c.tag} class="w-tab-close" aria-label="Close ${esc(it.label)}"${c.attrs}>${ctx.fns.w.icon({ name: "x", size: 12 })}</${c.tag}>`; })() : "";
        const current = it.id === opts.active ? ' aria-current="page"' : "";
        return `<span class="w-tab"${it.id === opts.active ? " data-active" : ""}><${tag} class="w-tab-main"${current} title="${esc(it.label)}"${attrs}>${it.icon ? ctx.fns.w.icon({ name: it.icon, size: 14 }) : ""}<span class="w-tab-label">${esc(it.label)}</span>${it.count ? `<span class="w-tab-count">${it.count}</span>` : ""}</${tag}>${close}</span>`;
    }).join("");
    return `<nav class="w-tabs" data-variant="${opts.variant ?? "equal"}" aria-label="Tabs">${tabs}</nav>`;
}
