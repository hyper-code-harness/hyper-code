// Record an error in the transcript AND surface it to whoever has a tab open.
//
// An error that only lands in the event list is an error nobody sees until
// they scroll: a run can fail while the reader is on another page. The toast
// carries the full text as its body, so the detail is one glance away rather
// than one dig away.
/** Append error event for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Error associated with the operation. */
error: string;
        /** Ts used by the operation. */
ts?: number }) {
    // A stop by the person is not an error: agent.stop already wrote one grey "stopped by user" line. Whatever
    // reports the cancelled run afterwards (the worker loop, a stream, a tool) is swallowed here — no row, no toast.
    if (/stopped_by_user|stopped by user|^\s*(?:Error:\s*)?(?:aborted|AbortError|This operation was aborted|The operation was aborted)/i.test(String(opts.error ?? ""))) return null;
    const appended = await ctx.fns.session.appendEventWithHtml({
        id: opts.id, type: "error", payload: { error: opts.error }, ts: opts.ts,
    });
    const text = String(opts.error ?? "");
    await ctx.fns.ui.notify({
        agentId: opts.id,
        level: "error",
        message: `${opts.id}: ${text.split("\n")[0]!.slice(0, 90)}`,
        body: text.length > 90 || text.includes("\n") ? text : undefined,
    }).catch(() => {});
    return appended;
}
