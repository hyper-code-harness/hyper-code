// A unified diff, coloured by the one thing that matters at a glance — the line
// that went in and the line that went out. The patch is git's own output.
/**
 * Perform diff for the ui subsystem.
 * @param opts.patch The patch value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {patch: string; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    if (!opts.patch.trim()) return `<div class="px-4 py-3 text-xs text-subtle">no textual change</div>`;
    const lines = opts.patch.split("\n").map(line => {
        const color = line.startsWith("+") && !line.startsWith("+++") ? "text-success bg-success/10"
            : line.startsWith("-") && !line.startsWith("---") ? "text-error bg-error/10"
                : line.startsWith("@@") ? "text-primary" : "text-muted";
        return `<span class="block px-4 ${color}">${esc(line) || "&nbsp;"}</span>`;
    }).join("");
    return `<pre class="overflow-x-auto py-2 text-xs leading-5 ${opts.class ?? ""}" ${ctx.fns.procs.ui.attr({ role: "diff" })}>${lines}</pre>`;
}
