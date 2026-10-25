/**
 * Draws the message input: attach, the text, tools (model, effort), and send — or stop with the "working" arc
 * while the agent runs. Compact puts everything on one line (the folded chat strip).
 * @param opts.post Where the form posts.
 * @param opts.placeholder Hint in the empty field. @default "Ask the agent…"
 * @param opts.tools Trusted HTML of the tool chips (model, effort).
 * @param opts.running The agent is working: stop instead of send.
 * @param opts.stop What stop does.
 * @param opts.compact One line: + text send. @default false
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** Where the form posts. */
    post: string;
    /** Hint in the empty field. @default "Ask the agent…" */
    placeholder?: string;
    /** Trusted HTML of the tool chips (model, effort). */
    tools?: string;
    /** The agent is working: stop instead of send. */
    running?: boolean;
    /** What stop does. */
    stop?: types.w.Action;
    /** One line: + text send. @default false */
    compact?: boolean;
}): string {
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: String(v ?? "") });
    const send = opts.running
        ? `<span class="w-send-wrap" data-running>${ctx.fns.w.iconButton({ icon: "stop", label: "Stop", action: opts.stop ?? { action: "stop" }, tone: "accent" })}</span>`
        : `<button type="submit" class="w-send" aria-label="Send">${ctx.fns.w.icon({ name: "arrow-up", size: 16 })}</button>`;
    const attach = ctx.fns.w.iconButton({ icon: "plus", label: "Attach files", action: { action: "attach" } });
    return `<form class="w-composer"${opts.compact ? " data-compact" : ""} hx-post="${esc(opts.post)}" hx-swap="none"><textarea name="text" rows="1" placeholder="${esc(opts.placeholder ?? "Ask the agent…")}"></textarea><div class="w-composer-bar">${attach}<span class="w-composer-tools">${opts.tools ?? ""}</span>${send}</div></form>`;
}
