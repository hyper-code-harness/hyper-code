/** Render sleep context html for the runtime.  * @param opts.sleepContext Persisted sleep context.
 * @param opts.events Agent events to render.
 * @param opts.agentId Target agent identifier.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Sleep context used by the operation. */
    sleepContext: Record<string, any>;
        /** Events to persist or render. */
    events: any[];
        /** Agent id used by the operation. */
    agentId: string },
): Promise<string> {
    const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: opts.sleepContext });
    if (sleep?.mode !== "compact") return "";
    const generation = ctx.fns.agent.getSleepGeneration({ sleepContext: sleep, kind: "active" });
    if (!generation) return "";
    const contextMessages = generation.contextAgentId
        ? await ctx.fns.session.getMessages({ id: String(generation.contextAgentId) })
        : generation.contextMessages;
    if (!Array.isArray(contextMessages) || contextMessages.length === 0) return "";

    const syntheticEvents = contextMessages.map((message: any) => ({
        type: message.role === "assistant" ? "assistant" : "user",
        text: typeof message.content === "string" ? message.content : JSON.stringify(message.content ?? ""),
        compactContext: true,
    }));
    const syntheticHtml = (await Promise.all(syntheticEvents.map((event: any) =>
        // No agentId: synthetic context is read-only and must not get transcript delete controls.
        ctx.fns.agent.renderEventHtml({ event }),
    ))).join("\n");

    // tailStart counts the agent's context history (inherited prefix + own rows,
    // excluded rows skipped), events carry the persisted own-row idx: map the
    // position to the idx of the row it points at.
    const h = await ctx.fns.agent.contextHistory({ id: opts.agentId });
    const { start } = ctx.fns.agent.compactTail({ generation, agentId: opts.agentId, inherited: h.inherited, length: h.messages.length });
    const tailStart = start ?? 0;
    const tailIdx = tailStart < h.inherited ? 0
        : tailStart >= h.messages.length ? Number(h.messages.at(-1)?.idx ?? -1) + 1
        : Number(h.messages[tailStart]?.idx ?? 0);
    const tailEvents = opts.events.filter((event: any) => {
        const idx = Number(event?.messageIdx);
        return Number.isInteger(idx) && idx >= tailIdx;
    });
    const tailHtml = await ctx.fns.agent.renderEventsHtml({ events: tailEvents, agentId: opts.agentId });
    const sourceOffset = h.messages.length;
    const hidden = Math.max(0, tailStart);

    const w = ctx.fns.w;
    const head = w.eventNote({
        text: "Compact context active",
        icon: "moon-stars",
        body: w.escape({ text: `The model sees the consolidation and recent messages. Full history is preserved; ${hidden} of ${sourceOffset} original messages are hidden.` }),
    });
    return `${head}\n${syntheticHtml}${tailHtml ? `\n${w.divider({ label: "recent messages" })}\n${tailHtml}` : ""}`;
}
