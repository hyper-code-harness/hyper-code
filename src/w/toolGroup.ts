/**
 * Draws a run of tool calls as one pill of icon cells (failed ones red), folded to "N tool calls ›" when long,
 * with the running call glowing and its seconds in grey after the pill.
 * @param opts.calls The calls in order; each opens its details on click.
 * @param opts.runningSince Start of the running call (ms) — adds the live seconds; omit when idle.
 * @param opts.fold Fold to a count above this many calls. @default 6
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The calls in order; each opens its details on click. */
    calls: Array<{ icon: string; title: string; error?: boolean; running?: boolean; action?: types.w.Action }>;
    /** Start of the running call (ms) — adds the live seconds; omit when idle. */
    runningSince?: number;
    /** Fold to a count above this many calls. @default 6 */
    fold?: number;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const fold = opts.fold ?? 6;
    const cell = (c: (typeof opts.calls)[number]) => {
        const { tag, attrs } = ctx.fns.w.actionAttrs({ action: c.action });
        const t = tag === "div" ? "button" : tag;
        return `<${t} class="w-tool"${c.error ? ' data-tone="danger"' : ""}${c.running ? " data-running" : ""} title="${esc(c.title)}" aria-label="${esc(c.title)}"${attrs || ' type="button"'}>${ctx.fns.w.icon({ name: c.icon, size: 12 })}</${t}>`;
    };
    const calls = opts.calls ?? [];
    const failed = calls.filter(c => c.error).length;
    // Folded: the failed and the running calls stay visible after the count; the rest opens in place. Each call is
    // drawn once — the visible ones are not repeated inside the fold.
    const shown = calls.filter(c => c.error || c.running);
    const hidden = calls.filter(c => !(c.error || c.running));
    const body = calls.length > fold
        ? `<details class="w-tool-fold"><summary class="w-tool-count" aria-label="${calls.length} tool calls${failed ? `, ${failed} failed` : ""}">${ctx.fns.w.icon({ name: "caret-right", size: 12 })}${calls.length} tool calls${failed ? ` · <span class="w-tool-failed">${failed} failed</span>` : ""}</summary><span class="w-tool-cells">${hidden.map(cell).join("")}</span></details>${shown.map(cell).join("")}`
        : calls.map(cell).join("");
    const clock = opts.runningSince ? `<span class="w-tool-clock tool-timer tool-row-clock" data-tool-started-at="${Number(opts.runningSince)}"></span>` : "";
    return `<div class="w-tool-row"><div class="w-tool-group">${body}</div>${clock}</div>`;
}
