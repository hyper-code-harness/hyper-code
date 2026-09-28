// Checkpoints are made by one model and are not always readable by another:
// a signed Claude block is rejected by Claude models without the compact
// strategy (haiku: 400) and means nothing to Codex; an encrypted Codex item is
// unreadable anywhere else. This adapts a stored checkpoint to the model that
// is about to read it, so switching models after compaction is seamless.

const SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

/**
 * Adapts compaction checkpoint messages to the model that will read them
 *
 * Native checkpoints (`anthropic_compaction`, `codex_compaction`) are kept only for the exact model that produced them. For any other model a Claude block becomes a plain text handoff summary (`compaction_summary`), and an opaque Codex item makes the checkpoint unusable: the function returns null and callers must fall back to the full, never-modified root transcript. Use wherever the active compact projection is assembled (buildLlmRequest, compactContext, autoCompactIfNeeded).
 * @param opts.model Provider-qualified model that will read the projection.
 * @param opts.producedBy Model recorded on the compaction generation that made the checkpoint.
 * @param opts.messages Checkpoint messages of the hidden compaction child.
 */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Provider-qualified model that will read the projection. */
        model: string;
        /** Model recorded on the compaction generation that made the checkpoint. */
        producedBy?: string | null;
        /** Checkpoint messages of the hidden compaction child. */
        messages: { role: string; content?: unknown; message_type?: string }[];
    },
): { role: string; content?: unknown; message_type?: string }[] | null {
    const same = !!opts.producedBy && opts.producedBy === opts.model;
    const out: { role: string; content?: unknown; message_type?: string }[] = [];
    for (const m of opts.messages) {
        if (m?.message_type === "anthropic_compaction") {
            if (same) { out.push(m); continue; }
            let block: any = null;
            try { block = typeof m.content === "string" ? JSON.parse(m.content) : m.content; } catch {}
            const text = typeof block?.content === "string" ? block.content.trim() : "";
            if (!text) return null;
            out.push({ role: "user", content: SUMMARY_PREFIX + "\n" + text, message_type: "compaction_summary" });
            continue;
        }
        if (m?.message_type === "codex_compaction") {
            if (same) { out.push(m); continue; }
            return null;
        }
        out.push(m);
    }
    return out;
}
