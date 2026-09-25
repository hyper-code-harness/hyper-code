// A slider — an integer or decimal on a bounded scale (a pain score 0–10).
// Native <input type="range">, no client JS: the readout shows the value the
// server knows, and because a questionnaire form re-renders itself on change,
// releasing the slider updates it. The ends are labelled with the bounds; the
// group carries data-field like ui.field. A range always has a value, so an
// untouched slider sits — and submits — at the middle of its scale.
/**
 * Perform range for the ui subsystem.
 * @param opts.name The target name.
 * @param opts.value The value to apply.
 * @param opts.min The min value used by the operation.
 * @param opts.max The max value used by the operation.
 * @param opts.step The step value used by the operation.
 * @param opts.class CSS classes to apply.
 * @param opts.ariaLabel The aria label value used by the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    name: string; value?: number | string; min?: number; max?: number; step?: number; class?: string; ariaLabel?: string;
}): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const min = opts.min ?? 0, max = opts.max ?? 10, step = opts.step ?? 1;
    const has = opts.value != null && opts.value !== "";
    const value = has ? Number(opts.value) : Math.round((min + max) / 2);
    return `<div class="${opts.class ?? ""}" ${ctx.fns.procs.ui.attr({ field: opts.name })}>
  <div class="flex items-baseline justify-between">
    <span class="text-subtle text-xs">${esc(min)}</span>
    <span class="text-base font-semibold tabular-nums">${esc(value)}</span>
    <span class="text-subtle text-xs">${esc(max)}</span>
  </div>
  <input type="range" name="${esc(opts.name)}" min="${esc(min)}" max="${esc(max)}" step="${esc(step)}" value="${esc(value)}"
    aria-label="${esc(opts.ariaLabel ?? opts.name)}" class="range range-sm range-primary mt-1 w-full">
</div>`;
}
