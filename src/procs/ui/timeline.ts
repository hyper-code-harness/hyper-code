// Events down a line — encounters, observations, what happened when. Each has a
// dot (tinted by tone), a title, a time and an optional body.
// The dot's colour is written out rather than built into the class name: a class
// Tailwind only ever sees as `bg-${tone}` is a class it never generates.
const TONE = {
    info: "bg-info", success: "bg-success",
    warning: "bg-warning", danger: "bg-error",
} as const;

/**
 * Perform timeline for the ui subsystem.
 * @param opts.items The items value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {items: Array<{ title: string; meta?: string; body?: string; tone?: keyof typeof TONE; icon?: string }>; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    return `<ol class="border-base-300 relative ml-2 border-l ${opts.class ?? ""}" ${ctx.fns.procs.ui.attr({ role: "timeline" })}>
  ${opts.items.map(it => `<li class="mb-5 ml-5" ${ctx.fns.procs.ui.attr({ role: "event" })}>
    <span class="absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${it.tone ? TONE[it.tone] : "bg-primary"}"></span>
    <div class="flex items-baseline justify-between gap-3">
      <p class="text-sm font-medium text-base-content">${it.icon ? `<i class="ph ${esc(it.icon)} mr-1 text-subtle" aria-hidden="true"></i>` : ""}${esc(it.title)}</p>
      ${it.meta ? `<span class="shrink-0 font-mono text-xs text-subtle">${esc(it.meta)}</span>` : ""}
    </div>
    ${it.body ? `<p class="mt-0.5 text-xs text-muted">${esc(it.body)}</p>` : ""}
  </li>`).join("")}
</ol>`;
}
