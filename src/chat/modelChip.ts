/**
 * Draws the model and effort chips of the chat input: "Opus 5.5 ▾" opens the provider/account/model picker,
 * "High ▾" next to it opens the reasoning-effort picker.
 *
 * The effort chip is left out when the current model has no reasoning levels to choose from.
 * @param opts.agentId Agent whose model is shown.
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Agent whose model is shown. */
    agentId: string;
}): Promise<string> {
    const id = String(opts.agentId ?? "");
    const agent = (ctx.state as any).agent?.[id] ?? await ctx.fns.session.load({ id });
    if (!agent) return "";
    const model = String(agent.model ?? "");
    const name = (model.split(":").pop() || model).replace(/^claude-/, "").replace(/-(\d+)-(\d+)$/, " $1.$2").replace(/-/g, " ").replace(/^\w/, c => c.toUpperCase());
    const requested = String(agent.reasoningEffort ?? "auto");
    const caps = await ctx.fns.llm.reasoningCapabilities({ model }).catch(() => null);
    const r = await ctx.fns.llm.resolveReasoningEffort({ model, effort: requested as any }).catch(() => null);
    const applied = String(r?.applied ?? "");
    const names: Record<string, string> = { auto: "Auto", off: "Off", minimal: "Minimal", low: "Low", medium: "Medium", high: "High", xhigh: "Max" };
    const w = ctx.fns.w;
    const effortChip = caps && caps.supported.filter((e: string) => e !== "off" && e !== "auto").length > 0 ? w.disclosure({
        label: names[requested] ?? requested,
        popup: { method: "agent.effortPicker", params: { agentId: id } },
        lead: w.icon({ name: "brain", size: 14 }),
        title: `Reasoning effort · ${requested === "auto" ? `auto → ${applied}` : requested}`,
        attrs: { "aria-label": `Change reasoning effort: ${requested}`, "data-chat-part": "effort", "data-action": "open-popup" },
    }) : "";
    return w.disclosure({
        label: name,
        popup: { method: "agent.modelPicker", params: { agentId: id } },
        lead: ctx.fns.ui.modelLogo({ model, bare: true, compact: true }),
        title: `Provider, account and model · ${model}`,
        attrs: { "aria-label": `Change model: ${model}`, "data-chat-part": "model", "data-action": "open-popup" },
    }) + effortChip;
}
