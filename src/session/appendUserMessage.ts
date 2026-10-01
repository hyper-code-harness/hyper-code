/**
 * Append a human-turn (role:user) message plus its UI event to an agent transcript.
 * Pass author to record who wrote it: a user id, or `agent:<id>` when another agent speaks
 * in this session under its own name (see agent.message). Without author the current
 * signed-in user (or the chat owner for background work) is recorded.
 * @param opts.id Target agent identifier.
 * @param opts.text Message text; must be non-empty.
 * @param opts.ts Timestamp in epoch milliseconds. @default Date.now()
 * @param opts.author Explicit author: user id or `agent:<id>`. @default auth.actorId
 * @param opts.messageType Stored message_type, e.g. `agent_message`. @default "message"
 * @param opts.eventExtra Extra fields merged into the UI event payload (e.g. sender title, onBehalfOf).
 */
export default async function (ctx: Context, _session: Session | null, opts: {
        /** Target agent identifier. */
        id: string;
        /** Message text; must be non-empty. */
        text: string;
        /** Timestamp in epoch milliseconds. @default Date.now() */
        ts?: number;
        /** Explicit author: user id or `agent:<id>`. @default auth.actorId */
        author?: string;
        /** Stored message_type, e.g. `agent_message`. @default "message" */
        messageType?: string;
        /** Extra fields merged into the UI event payload (e.g. sender title, onBehalfOf). */
        eventExtra?: Record<string, unknown> }): Promise<{ idx: number }> {
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
    const message: any = { role: "user", content: text };
    if (opts.author) message.author = opts.author;
    if (opts.messageType) message.message_type = opts.messageType;
    const out = await ctx.fns.session.appendMessage({ id, message, ts });
    const event = { ...(opts.eventExtra ?? {}), type: "user", text, messageIdx: out.idx, ts } as any;
    event.actor = opts.author ?? await ctx.fns.auth.actorId({ agentId: id }) ?? undefined;
    event.html = await ctx.fns.agent.renderEventHtml({ event, agentId: id });
    await ctx.fns.session.appendEvent({ id, event, ts });
    return out;
}
