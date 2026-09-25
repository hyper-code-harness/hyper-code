/** Render events html for the runtime.  * @param opts.events Agent events to render.
 * @param opts.agentId Target agent identifier.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Events to persist or render. */
    events: any[];
        /** Agent id used by the operation. */
    agentId: string },
): Promise<string> {
    const { events, agentId } = opts;

    // Always render, never serve a cached bubble: an event is data, and the
    // markup is a view of it that may change between two page loads (a tool
    // card ages, a renderer improves). Rendering a full transcript is ~7 ms.
    // One event may not take the transcript with it. The renderer is edited on
    // a live server — a half-landed refactor (a card calling a helper that
    // arrives a minute later), a row written before some validation existed —
    // and without isolation any of those turns every page of that agent into a
    // 500, which reads as "the app is down" rather than "one bubble is broken".
    return (await Promise.all(
        events.map(async (event: any) => {
            try {
                return await ctx.fns.agent.renderEventHtml({ event, agentId });
            } catch (error: any) {
                const message = String(error?.message ?? error);
                ctx.fns.procs.log.warn({ event: "renderEvent.failed", msg: `${agentId}#${event?.idx}: ${message}` });
                return `<div class="rounded-lg border border-error/30 bg-error/10 px-3 py-2 text-2xs text-error">`
                    + `this message could not be rendered (#${ctx.fns.procs.ui.escape({ text: String(event?.idx ?? "?") })})`
                    + `<div class="mt-0.5 font-mono text-error/80">${ctx.fns.procs.ui.escape({ text: message })}</div></div>`;
            }
        }),
    )).join("\n");
}