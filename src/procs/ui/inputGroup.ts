// An input with an addon — a unit, a prefix, a currency. The whole thing rings
// on focus as one control; the input itself carries `data-field`.
/**
 * Perform input group for the ui subsystem.
 * @param opts.name The target name.
 * @param opts.value The value to apply.
 * @param opts.placeholder The placeholder value used by the operation.
 * @param opts.type The kind of value.
 * @param opts.prefix The prefix value used by the operation.
 * @param opts.suffix The suffix value used by the operation.
 * @param opts.class CSS classes to apply.
 * @param opts.ariaLabel The aria label value used by the operation.
 */
export default function (ctx: Context, _session: Session | null, opts: {name: string; value?: string; placeholder?: string; type?: string; prefix?: string; suffix?: string; class?: string; ariaLabel?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const addon = (text: string, side: "l" | "r") => `<span class="flex select-none items-center ${side === "l" ? "border-r pl-3 pr-2" : "border-l pl-2 pr-3"} border-base-300 bg-base-200 text-xs text-subtle">${esc(text)}</span>`;
    return `<div class="ui-input-group flex overflow-hidden rounded-md border border-base-300 ${opts.class ?? ""}">
  ${opts.prefix ? addon(opts.prefix, "l") : ""}
  <input name="${esc(opts.name)}" ${ctx.fns.procs.ui.attr({ field: opts.name })}${opts.ariaLabel ? ` aria-label="${esc(opts.ariaLabel)}"` : ""} type="${esc(opts.type ?? "text")}" value="${esc(opts.value ?? "")}"
    placeholder="${esc(opts.placeholder ?? "")}" class="min-w-0 flex-1 border-0 bg-transparent px-3 py-1.5 text-sm outline-none">
  ${opts.suffix ? addon(opts.suffix, "r") : ""}
</div>`;
}
