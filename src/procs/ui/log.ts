// A scrollback of log lines — a service's output, a build. Newest at the bottom,
// the box scrolls, stderr is tinted. `stream` (an SSE url) makes it live: htmx 4's
// SSE extension streams unnamed events through the normal swap pipeline.
/**
 * Perform log for the ui subsystem.
 * @param opts.lines The lines value used by the operation.
 * @param opts.stream The stream value used by the operation.
 * @param opts.class CSS classes to apply.
 */
export default function (ctx: Context, _session: Session | null, opts: {lines?: Array<string | { text: string; stream?: string }>; stream?: string; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const line = (l: any) => {
        const text = typeof l === "string" ? l : l.text;
        const err = typeof l === "object" && l.stream === "err";
        return `<span class="block ${err ? "text-error" : "text-muted"}">${esc(text) || "&nbsp;"}</span>`;
    };
    const sse = opts.stream ? ` hx-sse:connect="${esc(opts.stream)}" hx-swap="beforeend"` : "";
    return `<div class="max-h-96 overflow-auto rounded-md border border-base-300 bg-base-200 p-3 font-mono text-xs leading-5 ${opts.class ?? ""}"${sse} ${ctx.fns.procs.ui.attr({ role: "log" })}>${(opts.lines ?? []).map(line).join("")}</div>`;
}
