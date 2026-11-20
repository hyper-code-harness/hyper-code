/**
 * Validate a delegated child model route and reasoning preference before creating the child
 *
 * Used by delegate and delegateTask before any child session or queued work exists. Omitted settings inherit the parent model and requested reasoning effort; an older parent without a preference uses auto. Resolves the endpoint without sending an inference request. Provider-specific effort downgrades remain the responsibility of llm.resolveReasoningEffort at request time.
 * @param opts.parent Parent whose model and requested reasoning preference supply defaults.
 * @param opts.model Child model route understood by llm.resolveEndpoint; surrounding whitespace is trimmed, and omission inherits the parent model.
 * @param opts.reasoningEffort Requested child reasoning preference; omitted inherits the parent preference, or auto for older parents.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Parent whose model and requested reasoning preference supply defaults. */
        parent: types.agent.Agent;
        /** Child model route understood by llm.resolveEndpoint; surrounding whitespace is trimmed, and omission inherits the parent model. */
        model?: string;
        /** Requested child reasoning preference; omitted inherits the parent preference, or auto for older parents. */
        reasoningEffort?: types.llm.ReasoningEffort;
    },
): Promise<{ model: string; reasoningEffort: types.llm.ReasoningEffort }> {
    const requestedModel = opts.model ?? opts.parent.model;
    const reasoningEffort = opts.reasoningEffort ?? opts.parent.reasoningEffort ?? "auto";
    if (typeof requestedModel !== "string" || !requestedModel.trim()) throw new Error("delegation: model must be a non-empty model route");
    const model = requestedModel.trim();
    const allowed: types.llm.ReasoningEffort[] = ["auto", "off", "minimal", "low", "medium", "high", "xhigh"];
    if (!allowed.includes(reasoningEffort)) throw new Error("delegation: invalid reasoningEffort; expected auto, off, minimal, low, medium, high or xhigh");
    try {
        await ctx.fns.llm.resolveEndpoint({ model });
    } catch (cause) {
        throw new Error(`delegation: cannot resolve model "${model}": ${cause instanceof Error ? cause.message : String(cause)}`, { cause });
    }
    return { model, reasoningEffort };
}
