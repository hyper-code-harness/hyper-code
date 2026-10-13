// Opens a form inside the chat and returns at once. The person answers when they
// like; the answer arrives to the agent as a new user turn (message_type
// "input"), so the agent ends its turn instead of waiting.
/**
 * Opens a live form in the chat — a secret, a confirmation, a choice or a pick from a filtered grid — and returns immediately.
 *
 * The form stays in the transcript as its own card: open while waiting, then replaced in
 * place by the answer. On submit or cancel the agent is woken with a user turn
 * `<input-result id kind state>` carrying a one-line summary and a JSON result (a secret
 * kind returns only its secret:// reference, never the value). End the turn after
 * calling; do not poll. Available kinds and their spec are listed in the system prompt
 * under "Chat inputs" (input.kinds returns them too).
 * @param opts.kind Input kind, e.g. secret, confirm, choice or grid.
 * @param opts.title Short question shown as the card heading.
 * @param opts.message Optional Markdown explanation under the heading.
 * @param opts.spec Kind-specific settings, e.g. { options } for choice or { saveAs } for secret.
 * @param opts.agentId Agent to wake with the answer. @default the current agent
 */
export default async function (ctx: Context, _session: Session | null, opts: {
    /** Input kind, e.g. secret, confirm, choice or grid. */
    kind: string;
    /** Short question shown as the card heading. */
    title: string;
    /** Optional Markdown explanation under the heading. */
    message?: string;
    /** Kind-specific settings, e.g. { options } for choice or { saveAs } for secret. */
    spec?: Record<string, any>;
    /** Agent to wake with the answer. @default the current agent */
    agentId?: string;
}): Promise<{ id: string; kind: string; state: "open"; agentId: string }> {
    const kindName = String(opts.kind ?? "").trim().toLowerCase();
    const kind = (ctx.state as any).input?.kinds?.[kindName] as types.input.Registered | undefined;
    if (!kind) {
        const known = Object.keys((ctx.state as any).input?.kinds ?? {}).sort().join(", ");
        throw new Error(`input.request: unknown kind "${kindName}" — available: ${known || "none"}`);
    }
    const title = String(opts.title ?? "").trim();
    if (!title) throw new Error("input.request: title is required");
    const agentId = String(opts.agentId ?? (await ctx.fns.agent.current({})).id);
    const spec = kind.prepare ? await kind.prepare(ctx, { spec: opts.spec ?? {} }) : (opts.spec ?? {});
    const id = "in" + Bun.randomUUIDv7().replace(/[^a-zA-Z0-9]/g, "").slice(-16);
    const now = Date.now();
    await ctx.fns.procs.db.run({
        sql: `INSERT INTO inputs (id, agent_id, kind, state, title, message, spec, created_at, updated_at)
              VALUES (?, ?, ?, 'open', ?, ?, ?::jsonb, ?, ?)`,
        params: [id, agentId, kindName, title, String(opts.message ?? ""), JSON.stringify(spec), now, now],
    });
    // messageIdx anchors the card in the transcript order: views that page or
    // fold by message (the compact "fresh tail") keep events that carry one.
    const lastIdx = Number((await ctx.fns.procs.db.select({ sql: "SELECT COALESCE(MAX(idx), -1) AS i FROM messages WHERE agent_id = ?", params: [agentId] }))[0]?.i ?? -1);
    const event: any = { type: "input", inputId: id, kind: kindName, title, ts: now, messageIdx: lastIdx + 1 };
    event.html = await ctx.fns.agent.renderEventHtml({ event, agentId });
    await ctx.fns.session.appendEvent({ id: agentId, event, ts: now });
    const live = (ctx.state as any).agent?.[agentId];
    if (live) await ctx.fns.session.syncAgentState({ agent: live });
    return { id, kind: kindName, state: "open", agentId };
}
