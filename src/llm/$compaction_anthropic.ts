// Claude models compact on the server (Anthropic compact-2026-09-04 beta): the
// transcript goes out with `compaction: {type:"summarize"}` and comes back as a
// signed `compaction` block with a readable summary. toAnthropicMessages replays
// it byte-for-byte as the first block of the request; streamAnthropic adds the
// beta header. Models without support fall back to the generic text summary.

/**
 * Compacts a Claude transcript into a native signed server compaction block.
 * @param opts.model Claude model identifier.
 * @param opts.messages Effective transcript to compact.
 */
export default async function (ctx: Context, session: Session | null, opts: Parameters<types.compaction.Compactor>[2]): Promise<types.compaction.CompactionResult> {
    try {
        const { block } = await ctx.fns.llm.compactAnthropic({ model: opts.model, instructions: opts.instructions, focus: opts.focus, messages: opts.messages, signal: opts.signal });
        return { message: { role: "user", content: JSON.stringify(block), message_type: "anthropic_compaction" }, summary: block.content };
    } catch (error: any) {
        opts.signal?.throwIfAborted();
        const fallback = (ctx.state as any).compaction?.compactors?.default as types.compaction.CompactorEntry | undefined;
        if (!fallback) throw error;
        ctx.fns.procs.log.warn({ event: "compaction.anthropic-fallback", msg: String(error?.message ?? error).slice(0, 300) });
        return fallback.compact(ctx, session, opts);
    }
}
