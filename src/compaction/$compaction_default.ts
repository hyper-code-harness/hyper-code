// Generic text compaction for any provider without its own `$compaction_<provider>.ts`.
// Ported from Codex's local (non-remote) compaction, codex-rs/core/src/compact.rs:
// the same handoff prompt and summary prefix, and on a context-window overflow
// the oldest history item is dropped and the request retried, so a transcript
// larger than the summarizer's window still compacts instead of failing.

const SUMMARIZATION_PROMPT = `You are performing a CONTEXT CHECKPOINT COMPACTION. Create a handoff summary for another LLM that will resume the task.

Include:
- Current progress and key decisions made
- Important context, constraints, or user preferences
- What remains to be done (clear next steps)
- Any critical data, examples, or references needed to continue
- Exact identifiers, file paths, commands and errors that matter

Recent messages after this summary will be preserved verbatim. Do not repeat runtime/system instructions. Do not continue the task.
Be concise, structured, and focused on helping the next LLM seamlessly continue the work.`;

const SUMMARY_PREFIX = "Another language model started to solve this problem and produced a summary of its thinking process. You also have access to the state of the tools that were used by that language model. Use this to build on the work that has already been done and avoid duplicating work. Here is the summary produced by the other language model, use the information in this summary to assist with your own analysis:";

const OVERFLOW = /context_length_exceeded|request_too_large|prompt is too long|exceeds the context|exceeded model token limit|maximum context length|\b413\b/i;

/**
 * Summarizes a transcript into one handoff message with the agent's own model.
 * @param opts.model Model used for the summary.
 * @param opts.messages Effective transcript to compact.
 */
export default async function (ctx: Context, _session: Session | null, opts: Parameters<types.compaction.Compactor>[2]): Promise<types.compaction.CompactionResult> {
    const system = SUMMARIZATION_PROMPT + (opts.focus?.trim() ? "\n\nFocus instructions: " + opts.focus.trim() : "");
    let history = [...opts.messages];
    for (;;) {
        opts.signal?.throwIfAborted();
        try {
            const call = await ctx.fns.llm.call({ model: opts.model, sessionId: opts.sessionId, system, user: JSON.stringify(history) });
            const summary = String(call.text ?? "").trim();
            if (!summary) throw new Error("compaction summary was empty");
            return { message: { role: "user", content: SUMMARY_PREFIX + "\n" + summary, message_type: "compaction_summary" }, summary };
        } catch (error: any) {
            if (!OVERFLOW.test(String(error?.message ?? error)) || history.length <= 1) throw error;
            // Trim from the beginning (keeps the recent, most relevant part) and
            // never leave a tool result without the call that produced it.
            history = history.slice(1);
            while (history.length > 1 && history[0]?.role === "tool") history = history.slice(1);
            ctx.fns.procs.log.warn({ event: "compaction.overflow-trim", msg: `dropped oldest item, ${history.length} left` });
        }
    }
}
