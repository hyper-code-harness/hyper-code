/**
 * Draws a tab strip: equal-width tabs that fill a header row (the canvas) or an underlined strip (pages).
 * Each tab can carry an icon, a count and a close button. A pinned tab is drawn short — its icon, or without one
 * two letters of its label (initials of the first two words) — the full label stays
 * its accessible name and tooltip) and never gets a close button; `draggable` marks a strip whose tabs can be
 * reordered by drag and drop (the page's script handles the drop).
 * @param opts.items The tabs, in order; attrs and closeAttrs are behaviour hooks (w.hooks) on the tab and its close button.
 * @param opts.active Id of the open tab.
 * @param opts.variant Look of the strip. @default "equal"
 * @param opts.end Trusted HTML at the right end of the strip (tools, an edit toggle).
 * @param opts.draggable Tabs can be dragged to another place (adds draggable and data-draggable). @default false
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The tabs, in order. */
    items: Array<{ id: string; label: string; icon?: string; pinned?: boolean; count?: number; action?: types.w.Action; close?: types.w.Action; title?: string; attrs?: Record<string, string | number | boolean | null | undefined>; closeAttrs?: Record<string, string | number | boolean | null | undefined> }>;
    /** Id of the open tab. */
    active?: string;
    /** Look of the strip. @default "equal" */
    variant?: "equal" | "underline";
    /** Trusted HTML at the right end of the strip (tools, an edit toggle). */
    end?: string;
    /** Tabs can be dragged to another place (adds draggable and data-draggable). @default false */
    draggable?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: String(v ?? "") });
    // Navigation tabs (each opens a page or a canvas tab): a nav of links/buttons with aria-current on the open one —
    // not role="tablist", which promises arrow-key tab panels these strips do not have.
    const tabs = (opts.items ?? []).map(it => {
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: it.action ?? { action: "select-tab" } });
        const close = it.close && !it.pinned ? (() => { const c = ctx.fns.w.actionAttrs({ action: it.close }); return `<${c.tag} class="w-tab-close" aria-label="Close ${esc(it.label)}"${ctx.fns.w.hooks({ attrs: it.closeAttrs })}${c.attrs}>${ctx.fns.w.icon({ name: "x", size: 12 })}</${c.tag}>`; })() : "";
        const current = it.id === opts.active ? ' aria-current="page"' : "";
        return `<span class="w-tab"${it.id === opts.active ? " data-active" : ""}${it.pinned ? " data-pinned" : ""}${opts.draggable ? ' draggable="true"' : ""}><${tag} class="w-tab-main"${current} title="${esc(it.title ?? it.label)}"${it.pinned ? ` aria-label="${esc(it.label)}"` : ""}${ctx.fns.w.hooks({ attrs: it.attrs })}${attrs}>${it.icon ? ctx.fns.w.icon({ name: it.icon, size: 14 }) : ""}${it.pinned ? (it.icon ? "" : `<span class="w-tab-label" data-short>${esc(short(it.label))}</span>`) : `<span class="w-tab-label">${esc(it.label)}</span>`}${it.count ? `<span class="w-tab-count">${it.count}</span>` : ""}</${tag}>${close}</span>`;
    }).join("");
    return `<nav class="w-tabs" data-variant="${opts.variant ?? "equal"}"${opts.draggable ? " data-draggable" : ""} aria-label="Tabs">${tabs}${opts.end ? `<span class="w-tabs-end">${opts.end}</span>` : ""}</nav>`;
}

/** Two letters for a pinned tab: initials of the first two words ("Hyper Architecture Map" → "HA"), else the first two letters ("Tests" → "Te"). */
function short(label: string): string {
    const words = label.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
    if (words.length >= 2) return (words[0]![0]! + words[1]![0]!).toUpperCase();
    const w = words[0] ?? label;
    return w.slice(0, 1).toUpperCase() + w.slice(1, 2);
}
