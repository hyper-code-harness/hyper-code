// Codex subscription models compact on the server: the transcript goes to the
// Responses endpoint with a compaction_trigger and comes back as an opaque,
// encrypted checkpoint that toCodexInput replays as {type:"compaction"}.

/**
 * Compacts a Codex transcript into a native encrypted server checkpoint.
 * @param opts.model Codex model identifier.
 * @param opts.messages Effective transcript to compact.
 */
export default async function (ctx: Context, _session: Session | null, opts: Parameters<types.compaction.Compactor>[2]): Promise<types.compaction.CompactionResult> {
    const checkpoint = await ctx.fns.llm.compactCodex({ model: opts.model, sessionId: opts.sessionId, instructions: opts.instructions, messages: opts.messages, signal: opts.signal });
    return {
        message: { role: "user", content: JSON.stringify(checkpoint.item), message_type: "codex_compaction" },
        summary: `Native Codex server checkpoint · ${checkpoint.responseId}`,
    };
}
