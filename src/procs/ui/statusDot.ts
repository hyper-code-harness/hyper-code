// A coloured dot for a state — running, ready, crashed — read from the word, so
// a service card or a resource status shows its health at a glance. `data-status`
// carries the raw state.
// the shared component layer's `status` is exactly this dot, and `status-*` carries the colour.
const TONE: Record<string, string> = { running: "status-success", ready: "status-success", ok: "status-success", active: "status-success", completed: "status-success", crashed: "status-error", error: "status-error", failed: "status-error", starting: "status-warning", restarting: "status-warning", draft: "status-warning", idle: "status-neutral", stopped: "status-neutral" };
/**
 * Perform status dot for the ui subsystem.
 * @param opts.status The status value.
 * @param opts.label The display label.
 * @param opts.class CSS classes to apply.
 * @deprecated use w.dot
 */
export default function (ctx: Context, _session: Session | null, opts: {status: string; label?: string; class?: string }): string {
    const esc = (s: any) => ctx.fns.procs.ui.escape({ text: s });
    const tone = TONE[opts.status?.toLowerCase()] ?? "status-neutral";
    const beat = opts.status === "running" || opts.status === "starting" ? " animate-pulse" : "";
    return `<span class="inline-flex items-center gap-1.5 text-sm ${opts.class ?? ""}" ${ctx.fns.procs.ui.attr({ role: "status", status: opts.status })}>
  <span class="status ${tone}${beat}"></span>${opts.label !== undefined ? `<span>${esc(opts.label)}</span>` : ""}</span>`;
}
