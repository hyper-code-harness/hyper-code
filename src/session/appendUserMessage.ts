/** Append user message for the runtime. */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Agent identifier. */
id: string;
        /** Text used by the operation. */
text: string;
        /** Ts used by the operation. */
ts?: number }) {
    const { id, text } = opts;
    // A user turn with no text is never valid: it carries nothing for the model
    // and persists as a NULL-content row that later 400s the Anthropic call
    // ("text content blocks must be non-empty"). The only way this happens is a
    // caller bug (e.g. a reentrant agent.run() with userText === undefined), so
    // fail loudly here rather than poison the transcript.
    if (text == null || String(text).trim() === "") {
        throw new Error("appendUserMessage: refusing to append empty user text");
    }
    const ts = opts.ts ?? Date.now();
    const out = await ctx.fns.session.appendMessage({ id, message: { role: "user", content: text }, ts });
    const event = { type: "user", text, messageIdx: out.idx, ts } as any;
    event.actor = await ctx.fns.auth.actorId({ agentId: id }) ?? undefined;
    event.html = await ctx.fns.agent.renderEventHtml({ event, agentId: id });
    await ctx.fns.session.appendEvent({ id, event, ts });
    return out;
}
