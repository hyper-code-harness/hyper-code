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

    const tailStart = Math.max(0, Number(generation.tailStart ?? generation.sourceOffset ?? 0));
    const tailEvents = opts.events.filter((event: any) => {
        const idx = Number(event?.messageIdx);
        return Number.isInteger(idx) && idx >= tailStart;
    });
    const tailHtml = await ctx.fns.agent.renderEventsHtml({ events: tailEvents, agentId: opts.agentId });
    const sourceOffset = Math.max(0, Number(generation.sourceOffset ?? 0));
    const hidden = Math.max(0, tailStart);

    return `<div class="rounded-lg border border-ui-border bg-base-200 px-3 py-2 text-xs text-muted">
  <div class="flex items-center gap-2 font-medium"><i class="ph ph-moon-stars"></i> Компактный контекст активен</div>
  <div class="mt-1 text-subtle">Модель видит консолидацию и свежий хвост. Полная история сохранена; скрыто ${hidden} из ${sourceOffset} исходных сообщений.</div>
</div>\n${syntheticHtml}${tailHtml ? `\n<div class="flex items-center gap-2 py-1 text-3xs uppercase tracking-wide text-faint"><span class="h-px flex-1 bg-ui-border"></span>свежий хвост<span class="h-px flex-1 bg-ui-border"></span></div>\n${tailHtml}` : ""}`;
}
