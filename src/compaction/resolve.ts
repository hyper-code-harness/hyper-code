/**
 * Selects the context compactor for a model
 *
 * Returns the `$compaction_<provider>` compactor registered for the model's provider, falling back to `$compaction_default`. Use before compacting an agent context so provider-native strategies (such as Codex server checkpoints) win over the generic text summary.
 * @param opts.model Provider-qualified model such as `codex:gpt-5`, `codex/work:gpt-5` or `anthropic:claude-sonnet-4-5`.
 */
export default function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider-qualified model such as `codex:gpt-5`, `codex/work:gpt-5` or `anthropic:claude-sonnet-4-5`. */
        model: string;
    },
): types.compaction.CompactorEntry & { fallback: boolean } {
    const compactors = (ctx.state as any).compaction?.compactors as types.compaction.State["compactors"] ?? {};
    const provider = /^([^:/]+)(?:\/[^:]+)?:/.exec(String(opts.model ?? ""))?.[1]?.toLowerCase() ?? "";
    const own = provider ? compactors[provider] : undefined;
    if (own) return { ...own, fallback: false };
    const fallback = compactors.default;
    if (!fallback) throw new Error(`no compactor for ${provider || opts.model}: add $compaction_${provider || "default"}.ts`);
    return { ...fallback, fallback: true };
}
