/**
 * Renders a compact labeled progress indicator
 *
 * Renders a reusable semantic progress bar with optional label and fraction. Use in inspector panels, plans, delegated teams, and other dense progress summaries.
 * @param opts.value Completed amount. Values are clamped between zero and max. @minimum 0
 * @param opts.max Total amount represented by the bar. @minimum 0
 * @param opts.label Optional label displayed above the bar.
 * @param opts.tone Semantic progress color. @default primary
 * @param opts.showValue Show the completed and total fraction. @default true
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Completed amount. Values are clamped between zero and max. @minimum 0 */
        value: number;
        /** Total amount represented by the bar. @minimum 0 */
        max: number;
        /** Optional label displayed above the bar. */
        label?: string;
        /** Semantic progress color. @default primary */
        tone?: "primary" | "success" | "warning" | "error";
        /** Show the completed and total fraction. @default true */
        showValue?: boolean;
    },
): string {
    const esc = (value: string) => ctx.fns.procs.ui.escape({ text: value });
    const max = Math.max(0, Number(opts.max));
    const value = Math.max(0, Math.min(max, Number(opts.value)));
    const percent = max > 0 ? Math.round(value / max * 100) : 0;
    const tone = opts.tone ?? 'primary';
    const colors = { primary: 'progress-primary', success: 'progress-success', warning: 'progress-warning', error: 'progress-error' } as const;
    const head = opts.label || opts.showValue !== false ? `<div class="mb-1 flex items-center gap-2 text-2xs text-subtle">${opts.label ? `<span class="min-w-0 flex-1 truncate">${esc(opts.label)}</span>` : '<span class="flex-1"></span>'}${opts.showValue !== false ? `<span class="shrink-0 font-mono tabular-nums">${value}/${max}</span>` : ''}</div>` : '';
    return `<div data-progress="${percent}">${head}<progress class="progress ${colors[tone]} h-1.5 w-full" value="${value}" max="${max || 1}" aria-label="${esc(opts.label ?? 'Progress')}: ${percent}%"></progress></div>`;
}
