// Close tool calls that never got an answer.
//
// Every provider refuses a transcript where an assistant called a tool and no
// result followed: OpenAI says "No tool output found for function call …",
// Anthropic rejects the unmatched tool_use. And a run CAN die between the two
// writes — the process restarts, the machine sleeps, someone kills it — which
// leaves the agent permanently unable to speak: every later request replays the
// same broken history and 400s again. The agent cannot fix that from inside;
// nothing it says ever reaches the model.
//
// So a dangling call gets a synthetic answer saying what actually happened. The
// history stays honest (the call really was made, its outcome really is
// unknown) and the conversation continues.
//
// The opposite break is just as fatal: a tool result whose call is not before
// it. Anthropic answers 400 "unexpected tool_use_id … no corresponding tool_use
// block", OpenAI "No tool call found for function call output". It appears when
// history is cut between a call and its result (a compaction boundary, a fork
// offset). Such a result says nothing the model can use without its call, so it
// is dropped from the request — never from the stored transcript.
/** Close tool calls that never got an answer and drop tool results that have no preceding call, so any provider accepts the transcript. Returns new arrays; stored messages are not mutated. */
export default function (
    _ctx: Context,
    _session: Session | null,
    opts: {
        /** Transcript about to be sent to a provider, oldest first. */
    messages: any[] },
): { messages: any[]; repaired: { id: string; name: string; afterIdx: number }[]; dropped: { id: string; at: number }[] } {
    const messages = opts.messages ?? [];
    // A call counts as answered only by a result that comes AFTER it.
    const answered = new Set<any>();
    const seen = new Set<string>();
    for (const m of messages) {
        for (const call of m?.tool_calls ?? []) seen.add(String(call.id));
        if (m?.role === "tool" && m.tool_call_id != null && seen.has(String(m.tool_call_id))) answered.add(m.tool_call_id);
    }

    const repaired: { id: string; name: string; afterIdx: number }[] = [];
    const dropped: { id: string; at: number }[] = [];
    // Calls issued so far and not yet answered: a result is valid only after its call, once.
    const open = new Set<string>();
    const out: any[] = [];
    messages.forEach((m: any, at: number) => {
        if (m?.role === "tool" && m.tool_call_id != null) {
            if (!open.delete(String(m.tool_call_id))) { dropped.push({ id: String(m.tool_call_id), at }); return; }
        }
        out.push(m);
        for (const call of m?.tool_calls ?? []) {
            open.add(String(call.id));
            if (answered.has(call.id)) continue;
            answered.add(call.id);
            open.delete(String(call.id));
            repaired.push({ id: call.id, name: call.name, afterIdx: out.length - 1 });
            out.push({
                role: "tool",
                tool_call_id: call.id,
                content: `(no result recorded — the run was interrupted before ${call.name} reported back; re-run it if you still need the answer)`,
                excluded_from_cursor: true,
            });
        }
    });

    return { messages: out, repaired, dropped };
}
