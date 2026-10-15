// Record a tool call in the transcript. It renders as a compact icon; clicking
// the icon opens a sticky popup with the already-highlighted arguments/result
// (agent chat.js). Tool activity is intentionally pull-based — automatic toasts
// for every call obscured the conversation and duplicated the same content.
/** Append tool call event for the runtime. */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {

        /** Agent identifier. */
        id: string;

        /** Payload used by the operation. */
        payload: { name: string; args: any; result: string; isError: boolean; messageIdx?: number; result_ref?: types.agent.ResultRef | null };

        /** Ts used by the operation. */
        ts?: number;
    },
) {
    return await ctx.fns.session.appendEventWithHtml({
        id: opts.id,
        type: "tool_call",
        payload: opts.payload,
        ts: opts.ts,
    });
}
