/**
 * Draws a grid of headline numbers, each with a quiet label, the value (optionally in a tone) and a small line under
 * it. Use it at the top of an audit or dashboard page.
 * @param opts.items The numbers in order: label above, value, sub under it, tone for the value's meaning, role for the data-role marker.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The numbers in order: label above, value, sub under it, tone for the value's meaning, role for the data-role marker. */
    items: Array<{ label: string; value: string | number; sub?: string; tone?: "info" | "success" | "warning" | "danger"; role?: string }>;
}): string {
    const esc = (v: unknown) => ctx.fns.w.escape({ text: v });
    const one = (s: (typeof opts.items)[number]) => `<div class="w-stat"${s.role ? ` ${ctx.fns.w.marks({ role: s.role })}` : ""}><span class="w-stat-label">${esc(s.label)}</span><span class="w-stat-value"${s.tone ? ` data-tone="${s.tone}"` : ""}>${esc(s.value)}</span>${s.sub ? `<span class="w-stat-sub">${esc(s.sub)}</span>` : ""}</div>`;
    return `<div class="w-stats">${opts.items.map(one).join("")}</div>`;
}
