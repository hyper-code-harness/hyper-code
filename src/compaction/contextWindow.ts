/**
 * Returns the known input context window of a model in tokens
 *
 * Maps a provider-qualified model id to a conservative input context window (Claude 200K, Codex/GPT-5+ 272K, long-context families 1M, common open models 128K). Returns null when unknown. Use to derive auto-compaction thresholds as a fraction of the model window.
 * @param opts.model Provider-qualified model such as `claude-code:claude-opus-5` or `codex:gpt-5.6-sol`.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider-qualified model such as `claude-code:claude-opus-5` or `codex:gpt-5.6-sol`. */
        model: string;
    },
): number | null {
    const m = String(opts.model ?? "").toLowerCase();
    const id = m.includes(":") ? m.slice(m.indexOf(":") + 1) : m;
    const provider = /^([^:/]+)/.exec(m)?.[1] ?? "";
    if (/claude|opus|sonnet|haiku|fable/.test(id)) return 200_000;
    if (provider === "codex" || /^gpt-(5|6)|daybreak/.test(id)) return 272_000;
    if (/^gpt-4\.1|gemini/.test(id)) return 1_000_000;
    if (/kimi|deepseek|qwen|glm|grok/.test(id)) return 128_000;
    return null;
}
