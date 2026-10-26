/** Keep tool output inline up to the tool's declared limits and store the rest as an immutable result file.
 * The tool's declaration decides the budget and which end is kept (outputLimits in $tool_<name>.md);
 * without one it is 2000 lines / 50 KB of the head. Cuts fall on line boundaries and the note says
 * exactly which lines are shown. Returns bounded transcript content and, only after a successful
 * write, its structured reference — callers persist result_ref alongside content so readResult can
 * authorize retrieval. Storage failures return an explicit unavailable notice without a reference.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent that owns the tool output and the stored result file. */
        agent: types.agent.Agent;
        /** Complete tool output. */
        output: string;
        /** Tool name, stored as the result's kind. */
        kind: string;
        /** The tool's declared outputLimits; omitted fields use 2000 lines, 50 KB and head. */
        limits?: types.tools.Tool["outputLimits"];
    },
): Promise<{ content: string; result_ref?: types.agent.ResultRef }> {
    const { agent, kind } = opts;
    const output = String(opts.output ?? "");
    const retain = opts.limits?.retain === "tail" ? "tail" : "head";
    const cut = ctx.fns.tools.truncate({ text: output, keep: retain, maxLines: opts.limits?.maxLines, maxBytes: opts.limits?.maxBytes });
    if (!cut.truncated) return { content: output };

    const fromTail = retain === "tail";
    const { ref: result_ref, storageError } = await ctx.fns.resultStore.prepare({ ownerAgentId: agent.id, kind, text: output, inlineLimit: 0, tail: fromTail });
    const shown = cut.firstLine === cut.lastLine ? `line ${cut.firstLine}` : `lines ${cut.firstLine}–${cut.lastLine}`;
    const label = `output truncated: showing ${shown} of ${cut.totalLines} (${output.length} characters in all)`;
    if (!result_ref) {
        const reason = storageError ?? "unavailable";
        const note = `[${label} — result storage failed: ${reason}. Full output was NOT saved; no retrieval reference is available.]`;
        return { content: fromTail ? `${note}\n${cut.text}` : `${cut.text}\n${note}` };
    }
    const id = JSON.stringify(result_ref.id);
    const next = fromTail ? 0 : cut.text.length;
    const note = `[${label}. Full output saved; read more with eval: ` +
        `const r = await ctx.fns.agent.readResult({ id: ${id}, offset: ${next}, limit: 16000 }); r.ok ? r.text : r.error]`;
    return { content: fromTail ? `${note}\n${cut.text}` : `${cut.text}\n${note}`, result_ref };
}
