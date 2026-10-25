/**
 * Draws a toast — the small note in the corner after something happened. The server sends the same markup with
 * ui.notify; this is the piece both use and the gallery shows.
 * @param opts.message One line.
 * @param opts.level Kind of news. @default "info"
 * @param opts.body Optional longer text under the line.
 * @param opts.action Optional button.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** One line. */
    message: string;
    /** Kind of news. @default "info" */
    level?: "info" | "success" | "warning" | "error";
    /** Optional longer text under the line. */
    body?: string;
    /** Optional button. */
    action?: { label: string } & types.w.Action;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const icon = { info: "info", success: "check-circle", warning: "warning", error: "warning-circle" }[opts.level ?? "info"];
    const btn = opts.action ? (() => { const { tag, attrs } = ctx.fns.w.actionAttrs({ action: opts.action }); const t = tag === "div" ? "button" : tag; return `<${t} class="w-toast-action"${attrs}>${esc(opts.action.label)}</${t}>`; })() : "";
    // data-role="notice" + data-tone: how page.state().notices and page.text({ role: "notice" }) read the outcome.
    const tone = { info: "info", success: "success", warning: "warning", error: "danger" }[opts.level ?? "info"];
    return `<div class="w-toast" role="status" data-role="notice" data-tone="${tone}" data-level="${opts.level ?? "info"}">${ctx.fns.w.icon({ name: icon, size: 16 })}<div class="w-toast-text"><div>${esc(opts.message)}</div>${opts.body ? `<div class="w-toast-body">${esc(opts.body)}</div>` : ""}</div>${btn}</div>`;
}
