/**
 * Draws the round send button of a message input — or, while the agent works, the round stop button with the
 * turning "working" arc around it. The one place that decides how send and stop look, so the composer and a live
 * region that swaps only this button (the chat's stop control) draw the same thing.
 * @param opts.running The agent is working: stop instead of send. @default false
 * @param opts.stop What stop does. @default { action: "stop" }
 * @param opts.marks Automation markers on the stop button (w.marks keys).
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** The agent is working: stop instead of send. @default false */
    running?: boolean;
    /** What stop does. @default { action: "stop" } */
    stop?: types.w.Action;
    /** Automation markers on the stop button (w.marks keys). */
    marks?: { action?: string; entity?: string; id?: string; status?: string; role?: string };
}): string {
    if (opts.running) {
        const stop = ctx.fns.w.pressable({ html: '<span class="w-send-stop" aria-hidden="true"></span>', label: "Stop generation", title: "Stop this run", action: opts.stop ?? { action: "stop" }, marks: opts.marks, class: "w-send" });
        return `<span class="w-send-wrap" data-running>${stop}</span>`;
    }
    return `<button type="submit" class="w-send" title="Send · Enter" aria-label="Send message">${ctx.fns.w.icon({ name: "arrow-up", size: 14 })}</button>`;
}
