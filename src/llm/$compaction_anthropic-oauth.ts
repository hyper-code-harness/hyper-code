// Claude subscription (anthropic-oauth): same native server compaction as $compaction_anthropic.

/**
 * Compacts a anthropic-oauth transcript with Anthropic server compaction.
 * @param opts.model Claude model identifier.
 */
export default async function (ctx: Context, session: Session | null, opts: Parameters<types.compaction.Compactor>[2]): Promise<types.compaction.CompactionResult> {
    return (ctx.state as any).compaction.compactors.anthropic.compact(ctx, session, opts);
}
