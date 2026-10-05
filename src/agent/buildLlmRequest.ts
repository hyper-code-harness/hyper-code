// Build the system + messages payload for an LLM call.
//
// Policy (option A — "system-as-messages"): the full instruction body lives
// as a synthetic user → assistant exchange at the start of the conversation;
// system is empty or near-empty. Rationale: models attend to recent user
// messages more reliably than to system, especially smaller / local models
// (Haiku, Llama). Moving instructions into the conversation also makes them
// visible in transcript debugging.
//
// Anthropic OAuth subscription (claude-code provider) is a special case:
// the server-side anti-fraud check rejects requests whose system prompt
// doesn't start with the Claude Code identity line. That line MUST stay in
// `system` regardless of policy. Everything else moves to messages.
//
// Returns:
//   { system: string, messages: Message[] }  — both ready to feed to a
//   streamer. messages is [bootstrap-user, bootstrap-ack, ...transcript].
/** Build llm request for the runtime.  * @param opts.agent Agent whose state is read or updated.
*/
export default async function (
    ctx: Context,
    _session: Session | null,
    opts: {
        /** Live agent instance to operate on. */
    agent: types.agent.Agent },
): Promise<{ system: string; messages: any[] }> {
    const { agent } = opts;
    const fullPrompt = await ctx.fns.agent.fullSystemPrompt({ agent });
    const fullHistory = agent.parentId
        ? await ctx.fns.session.getFullMessages({ id: agent.id })
        : (agent.messages ?? []);
    const sleep = ctx.fns.agent.normalizeSleepContext({ sleepContext: agent.sleepContext });
    const generation = sleep?.mode === "compact"
        ? ctx.fns.agent.getSleepGeneration({ sleepContext: sleep, kind: "active" })
        : null;
    const storedSleepMessages = generation?.contextAgentId
        ? await ctx.fns.session.getMessages({ id: String(generation.contextAgentId) })
        : generation?.contextMessages;
    // A checkpoint made by another model is adapted (Claude block → text) or,
    // when unreadable (Codex item), dropped in favour of the full transcript.
    const sleepMessages = storedSleepMessages?.length
        ? ctx.fns.compaction.portable({ model: agent.model, producedBy: generation?.model, messages: storedSleepMessages })
        : storedSleepMessages;
    const raw = generation && sleepMessages?.length && Number(generation.sourceOffset) <= fullHistory.length
        ? [...sleepMessages, ...fullHistory.slice(Math.max(0, Number(generation.tailStart ?? generation.sourceOffset)))]
        : fullHistory;

    // A call with no result is a transcript every provider refuses, and a run
    // that dies between the two writes leaves one behind. Repairing here — on
    // the way OUT, for whichever dialect — means such an agent answers again
    // instead of 400-ing forever on history it cannot edit.
    const { messages: base, repaired } = ctx.fns.session.repairToolPairs({ messages: raw });
    // The retrieved function catalogue USED to be spliced into the last user
    // message from here, and was never persisted: the transcript disagreed with
    // what the model saw, and a catalogue that changed between requests
    // invalidated the prompt cache from that message onwards. It is a
    // `world_state` transcript row now — see agent.syncWorldState, called once
    // per turn by agent.run. This function only reads history; it no longer
    // rewrites it.
    if (repaired.length) {
        ctx.fns.procs.log.warn({
            event: "transcript.repair",
            msg: `${agent.id}: closed ${repaired.length} unanswered tool call(s)`,
            calls: repaired.map(r => `${r.name}#${r.id}`),
        });
    }

    // Plugin blocks for this turn (`agent.promptAugment`) used to be spliced
    // into the last user message from here. They are collected by
    // agent.syncWorldState now and travel as a persisted tail row, for the same
    // reason as the function catalogue: a block that changes between requests
    // must not rewrite history the provider has already cached.
    const ep = await ctx.fns.llm.resolveEndpoint({ model: agent.model });
    const claudeCodeHeader = "You are Claude Code, Anthropic's official CLI for Claude.";

    // Nothing per-turn lives in the bootstrap: every byte there is the cached
    // prefix shared by all later requests and by transcript-sharing forks.
    // The status line is a persisted transcript row (see agent.run).
    let system = '';
    let bodyText = fullPrompt;
    const upstream = ep.provider === 'hyper' ? (ep.upstream ?? '') : ep.provider;
    if (upstream === 'claude-code' || upstream === 'anthropic-oauth') {
        system = claudeCodeHeader;
        if (bodyText.startsWith(claudeCodeHeader)) {
            bodyText = bodyText.slice(claudeCodeHeader.length).trimStart();
        }
    }

    const bootstrap = bodyText
        ? [
            { role: 'user' as const, content: bodyText },
            { role: 'assistant' as const, content: 'Understood. Ready to act.' },
        ]
        : [];

    // Several people may write into one chat: tell the model who said what. A copy for this
    // request only; with a single user nothing changes and the cached prefix stays identical.
    const attributed = await ctx.fns.auth.attributeMessages({ messages: base });
    if (attributed.applied && bootstrap.length) {
        bootstrap[0] = { role: 'user' as const, content: bootstrap[0]!.content + '\n\nSeveral people use this chat. Each human message starts with `<Name>:` — the person who wrote it. Answer that person; your own replies have no such prefix.' };
    }

    // Durable attachment refs stay tiny in Postgres and are materialized only
    // for this provider request. This keeps forks, BM25 and compaction free of
    // base64 while retaining native image/PDF input where supported.
    const messages = await ctx.fns.attachments.resolveContent({ messages: [...bootstrap, ...attributed.messages] });

    // Check for large tool call arguments before sending to LLM.
    // If a write/edit call has content > 100 KB, block it and instruct model.
    const LARGE_CONTENT_THRESHOLD = 100_000; // bytes
    const lastMsg = messages[messages.length - 1];
    if (lastMsg?.role === 'assistant' && lastMsg?.tool_calls?.length) {
        for (const call of lastMsg.tool_calls) {
            const contentArg = call.args?.content;
            if (typeof contentArg === 'string' && contentArg.length > LARGE_CONTENT_THRESHOLD) {
                // Remove the oversized calls from this message
                lastMsg.tool_calls = lastMsg.tool_calls.filter((c: any) => !(typeof c.args?.content === 'string' && c.args.content.length > LARGE_CONTENT_THRESHOLD));
                // Inject a guidance message instead
                const sizeKb = Math.round(contentArg.length / 1024);
                messages.push({
                    role: 'user' as const,
                    content: `⚠️ Large payload detected (${sizeKb} KB). To avoid token limit truncation, use one of these strategies:\n` +
                        `1. Generate content with eval, then write: const big = await ctx.fns.tools.eval({code: "..."}); await ctx.fns.files.write({path, content: big})\n` +
                        `2. Split into multiple smaller write/edit calls\n` +
                        `3. Use bash to create the file directly\n\n` +
                        `Reconsider your approach and try again.`,
                    excluded_from_cursor: true,
                });
                break;
            }
        }
    }

    // A transcript that ENDS with an assistant message is a "prefill" request:
    // the model is asked to continue its own half-written turn. It happens
    // normally here — a run answers a mid-run user message with a terminal
    // respondHtml, the worker reschedules for that same message, and the next
    // request replays a history whose last row is that final answer.
    //
    // Most models continue happily; some (claude-opus-5) reject the request
    // outright with 400 "does not support assistant message prefill", which
    // kills the run, leaves the cursor unadvanced and repeats forever. So the
    // request always ends on a user turn — a one-line nudge, never persisted.
    const last = messages[messages.length - 1];
    if (last?.role === 'assistant' && !(last.tool_calls?.length)) {
        messages.push({
            role: 'user',
            content: 'Continue from where you stopped: if the previous answer already settled the user\'s request, say so briefly; otherwise take the next step.',
        });
    }


    return {
        system,
        messages,
    };
}

