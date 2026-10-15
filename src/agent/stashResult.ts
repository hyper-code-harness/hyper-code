const LIMIT = 6_000;
const PREVIEW = 2_500;

/** Keep small tool outputs inline and store larger outputs as immutable result files.
 * Returns bounded transcript content and, only after a successful write, its structured
 * reference. Callers must persist result_ref alongside content so readResult can authorize
 * retrieval. Storage failures return an explicit unavailable notice without a reference.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Agent that owns the tool output and the stored result file. */
        agent: types.agent.Agent;
        /** Complete tool output; outputs up to 6000 JavaScript characters remain inline. */
        output: string;
        /** Tool name; bash previews retain the tail, other tools retain the head. */
        kind: string;
    },
): Promise<{ content: string; result_ref?: types.agent.ResultRef }> {
    const { agent, kind } = opts;
    const output = String(opts.output ?? "");
    if (output.length <= LIMIT) return { content: output };

    const fromTail = kind === "bash";
    const preview = fromTail ? output.slice(-PREVIEW) : output.slice(0, PREVIEW);
    const label = `${fromTail ? "tail" : "head"} preview of ${output.length} characters`;
    let result_ref: types.agent.ResultRef;
    try {
        result_ref = await ctx.fns.resultStore.write({ ownerAgentId: agent.id, kind, text: output });
    } catch (error) {
        const reason = String(error instanceof Error ? error.message : error).slice(0, 300);
        const note = `[${label} — result storage failed: ${reason}. Full output was NOT saved; no retrieval reference is available.]`;
        return { content: fromTail ? `${note}\n${preview}` : `${preview}\n${note}` };
    }
    const note = `[${label} — full output saved. Read a bounded range with eval: ` +
        `await ctx.fns.agent.readResult({ id: ${JSON.stringify(result_ref.id)}, offset: 0, limit: 4000 })]`;
    return { content: fromTail ? `${note}\n${preview}` : `${preview}\n${note}`, result_ref };
}
