/** Append assistant event for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Payload used by the operation. */
payload: { text: string; html: string; usage?: any; messageIdx?: number; instructionIndicators?: { statusLine?: string | null } };
        /** Ts used by the operation. */
ts?: number }) {
    return ctx.fns.session.appendEventWithHtml({ id: opts.id, type: "assistant", payload: opts.payload, ts: opts.ts });
}
