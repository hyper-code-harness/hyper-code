/**
 * Reports supported reasoning effort levels for a model route
 *
 * Return the safe reasoning effort choices, default and provider wire mode for a concrete provider/account/model route. Use when rendering controls and before constructing an LLM request.
 * @param opts.model Concrete model route in provider[/account]:modelId form.
 */
export default async function (
    ctx: Context,
    session: Session | null,
    opts: {
        /** Concrete model route in provider[/account]:modelId form. */
        model: string;
    },
): Promise<types.llm.ReasoningProfile> {
    const model = String(opts.model ?? "");
    const m = /^([a-z][\w-]*)(?:\/[\w.-]+)?:(.+)$/.exec(model);
    const provider = m?.[1] ?? "lmstudio";
    const modelId = String(m?.[2] ?? model).toLowerCase();
    // gpt-6 family rejects effort "none"/"minimal": only low..max on the wire.
    if ((provider === "codex" || provider === "openai") && /^gpt-6/.test(modelId)) {
        return { supported: ["auto", "low", "medium", "high", "xhigh"], defaultEffort: "medium", mode: "openai-effort" };
    }
    if (provider === "codex" || (provider === "openai" && /^gpt-5/.test(modelId))) {
        const xhigh = /gpt-5\.[2-9]|codex-max|5\.6/.test(modelId);
        return { supported: ["auto", "off", "minimal", "low", "medium", "high", ...(xhigh ? ["xhigh" as const] : [])], defaultEffort: "medium", mode: "openai-effort" };
    }
    if (provider === "xai" && /^grok-4(?:\.|$)/.test(modelId)) {
        return { supported: ["auto", "off", "minimal", "low", "medium", "high", "xhigh"], defaultEffort: "medium", mode: "openai-effort" };
    }

    if ((provider === "claude-code" || provider === "anthropic-oauth" || provider === "anthropic") && /(opus|sonnet)-4-6/.test(modelId)) {
        const max = /opus-4-6/.test(modelId);
        return { supported: ["auto", "off", "low", "medium", "high", ...(max ? ["xhigh" as const] : [])], defaultEffort: "medium", mode: "anthropic-adaptive" };
    }
    return { supported: ["auto", "off"], defaultEffort: "off", mode: "none" };
}
