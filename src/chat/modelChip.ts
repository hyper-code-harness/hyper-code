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
    const esc = (v: unknown) => ctx.fns.procs.ui.escape({ text: v });
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
    const effortChip = caps && caps.supported.filter((e: string) => e !== "off" && e !== "auto").length > 0 ? ctx.fns.ui.popup({
        method: "agent.effortPicker",
        params: { agentId: id },
        html: `<i class="ph ph-brain text-sm" aria-hidden="true"></i><span>${esc(names[requested] ?? requested)}</span><i class="ph ph-caret-down text-3xs text-faint" aria-hidden="true"></i>`,
        attrs: `class="inline-flex h-8 items-center gap-1 rounded-full px-2.5 text-xs text-muted hover:bg-base-200 hover:text-base-content" title="Reasoning effort · ${esc(requested === "auto" ? `auto → ${applied}` : requested)}" aria-label="Change reasoning effort: ${esc(requested)}" data-chat-part="effort"`,
    }) : "";
    const label = esc(name);
    return ctx.fns.ui.popup({
        method: "agent.modelPicker",
        params: { agentId: id },
        html: `${ctx.fns.ui.modelLogo({ model, bare: true, compact: true })}<span class="max-w-44 truncate">${label}</span><i class="ph ph-caret-down text-3xs text-faint" aria-hidden="true"></i>`,
        attrs: `class="inline-flex h-8 min-w-0 items-center gap-1.5 rounded-full px-2.5 text-xs text-muted hover:bg-base-200 hover:text-base-content" title="Provider, account and model · ${esc(model)}" aria-label="Change model: ${esc(model)}" data-chat-part="model"`,
    }) + effortChip;
}
