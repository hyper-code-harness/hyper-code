/**
 * Renders the provider, credential account and model picker for one agent.
 *
 * Wraps agent.modelPickerHtml (Provider → Account → Model navigation) in a popup. Submitting a model always uses scope=agent, so the action
 * moves only the selected agent; bulk migration remains a separate parked-card
 * action.
 *
 * @param opts.agentId Agent whose route should be inspected or changed.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Identifier of the live or persisted agent whose route can be changed. */
        agentId: string;
    },
): Promise<Response> {
    const id = String(opts.agentId ?? "").trim();
    if (!id) return new Response("agentId is required", { status: 400 });
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return new Response("agent not found", { status: 404 });

    const esc = (value: unknown) => ctx.fns.procs.ui.escape({ text: String(value ?? "") });
    const body = await ctx.fns.agent.modelPickerHtml({ current: String(agent.model ?? ""), mode: "agent", agentId: id });
    const html = body.includes("data-model-picker") ? `${body}<p class="mt-3 border-t border-ui-border pt-2 text-3xs text-faint">This changes only agent <span class="font-mono">${esc(id)}</span>. Chat history stays unchanged; the next call uses the selected account and model.</p>` : body;
    return new Response(ctx.fns.ui.popupContent({ title: "Provider, account and model", kind: "model-picker", class: "w-full max-w-3xl", html }), { headers: { "content-type": "text/html; charset=utf-8" } });
}
