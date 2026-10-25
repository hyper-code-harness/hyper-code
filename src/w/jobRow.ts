/**
 * Draws a background job as a row: what runs, its state, how long, and a link to its log.
 * @param opts.title What runs.
 * @param opts.status Job state.
 * @param opts.startedAt Start, ms since epoch.
 * @param opts.log Where the log opens.
 */
export default function (ctx: Context, _session: Session | null, opts: {
    /** What runs. */
    title: string;
    /** Job state. */
    status: "running" | "succeeded" | "failed" | "waiting";
    /** Start, ms since epoch. */
    startedAt?: number;
    /** Where the log opens. */
    log?: types.w.Action;
}): string {
    const icon = { running: "spinner-gap", succeeded: "check-circle", failed: "x-circle", waiting: "clock" }[opts.status];
    const dot = opts.status === "running" ? "running" : opts.status === "failed" ? "error" : undefined;
    return ctx.fns.w.listRow({ label: opts.title, icon, hint: opts.startedAt ? new Date(opts.startedAt).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" }) : opts.status, dot, action: opts.log });
}
