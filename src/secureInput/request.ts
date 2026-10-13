// Non-blocking variant of secureInput.prompt, kept for existing callers: it is
// input.request({ kind: "secret" }) — a form card in the chat instead of a popup.
/**
 * Opens a secret form in the chat that stores the answer as a secret and wakes the agent, without waiting
 *
 * Compatibility wrapper over input.request({ kind: "secret" }). Use instead of
 * secureInput.prompt when the value should become a durable secret://namespace/name entry
 * (sudo password, API key, account password) and the agent should end its turn while the
 * human types. On submit the value is encrypted into local secret storage and the agent
 * receives an <input-result kind="secret" state="submitted"> turn with the reference; on
 * cancel the state is "cancelled". The value never enters the transcript. Afterwards use
 * bash({ secrets: { VAR: ref } }) or secrets.get({ ref }).
 * @param opts.title Prompt title shown to the human.
 * @param opts.saveAs Destination reference in the form secret://namespace/name.
 * @param opts.message Optional explanatory prompt text.
 * @param opts.kind Input control kind. @default "password"
 * @param opts.maxlength Maximum accepted input length. @minimum 1 @maximum 4096
 * @param opts.agentId Agent to wake when the value arrives; defaults to the current agent.
 */
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Prompt title shown to the human. */
        title: string;
        /** Destination reference in the form secret://namespace/name. */
        saveAs: string;
        /** Optional explanatory prompt text. */
        message?: string;
        /** Input control kind. @default "password" */
        kind?: "otp" | "password" | "text";
        /** Maximum accepted input length. @minimum 1 @maximum 4096 */
        maxlength?: number;
        /** Agent to wake when the value arrives; defaults to the current agent. */
        agentId?: string;
    },
): Promise<{ id: string; ref: string; agentId: string }> {
    // Now a chat input of kind "secret": the form lives in the transcript as a
    // card (it survives a reload and several can be open), and the answer wakes
    // the agent as an <input-result> turn carrying only the reference.
    const kind = opts.kind ?? "password";
    if (!["otp", "password", "text"].includes(kind)) throw new Error("secureInput.request: invalid kind");
    const out = await ctx.fns.input.request({
        kind: "secret",
        title: opts.title,
        message: opts.message,
        spec: { saveAs: opts.saveAs, mode: kind, ...(opts.maxlength ? { maxlength: opts.maxlength } : {}) },
        agentId: opts.agentId,
    });
    const input = await ctx.fns.input.get({ id: out.id });
    return { id: out.id, ref: String(input?.spec.saveAs ?? opts.saveAs), agentId: out.agentId };
}
