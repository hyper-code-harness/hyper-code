/**
 * Tells every open page of an agent's chat that its canvas changed (canvas.changed event).
 *
 * Call after a committed canvas change. The event carries open/width and the panel fingerprint
 * (canvas.revision); pages apply open/width at once and refetch the panel only when the fingerprint differs.
 * @param opts.agentId Agent whose canvas changed.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose canvas changed. */
    agentId: string;
}): Promise<types.canvas.View & { rev: string }> {
    const [view, rev] = await Promise.all([ctx.fns.canvas.get({ agentId: opts.agentId }), ctx.fns.canvas.revision({ agentId: opts.agentId })]);
    ctx.fns.procs.events.emit({ event: { type: "canvas.changed", ...view, rev: rev.panel } });
    return { ...view, rev: rev.panel };
}
