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
    const sleepMessages = generation?.contextAgentId
        ? await ctx.fns.session.getMessages({ id: String(generation.contextAgentId) })
        : generation?.contextMessages;
    const raw = generation && sleepMessages?.length && Number(generation.sourceOffset) <= fullHistory.length
        ? [...sleepMessages, ...fullHistory.slice(Math.max(0, Number(generation.tailStart ?? generation.sourceOffset)))]
        : fullHistory;

    // A call with no result is a transcript every provider refuses, and a run
    // that dies between the two writes leaves one behind. Repairing here — on
    // the way OUT, for whichever dialect — means such an agent answers again
    // instead of 400-ing forever on history it cannot edit.
    const { messages: base, repaired } = ctx.fns.session.repairToolPairs({ messages: raw });
    const functionRag = await ctx.fns.agent.functionRag({ agent, messages: base }).catch((error: any) => {
        ctx.fns.procs.log.warn({ event: "agent.function-rag.failed", msg: String(error?.message ?? error), agentId: agent.id });
        return null;
    });
    if (functionRag) {
        const at = [...base].map((message: any, index: number) => ({ message, index })).reverse()
            .find(({ message }) => message?.role === "user" && typeof message.content === "string")?.index;
        if (at != null) {
            const message = base[at];
            // A run that retrieved nothing — or was stopped by the gate before it
            // retrieved — changes no prompt, but is still recorded, so the UI can
            // show that the decision happened and why.
            let injected = "";
            if (functionRag.functions.length) {
                const block = functionRag.functions.map((fn: any) => `- #${fn.rank} ${fn.name} [${fn.jev == null ? `RRF ${formatRagScore(fn.score)}` : `jev ${formatRagScore(fn.jev)}`}${fn.bm25 == null ? "" : ` · BM25 ${formatRagScore(fn.bm25)}`}${fn.similarity == null ? "" : ` · cos ${formatRagScore(fn.similarity)}`}]: ${fn.summary}\n  ${fn.signature}`).join("\n");
                injected = `<relevant_runtime_functions>\n${block}\n</relevant_runtime_functions>\nUse these only if relevant; inspect one with runtime.docs.get before calling when details are needed.`;
                base[at] = { ...message, content: `${message.content}\n\n${injected}` };
            }
            agent.scratchpad ??= {};
            agent.scratchpad.functionRag = { messageIdx: functionRag.messageIdx, functions: functionRag.functions.map((fn: any) => fn.name), reranked: functionRag.reranked === true, gate: functionRag.gate, rerankStatus: functionRag.rerankStatus, needsTool: functionRag.needsTool, retrieved: functionRag.retrieved, updatedAt: Date.now() };
            queueMicrotask(() => ctx.fns.agent.markFunctionRag({ agent, messageIdx: functionRag.messageIdx, functions: functionRag.functions, injected, reranked: functionRag.reranked === true, gate: functionRag.gate, rerankStatus: functionRag.rerankStatus, needsTool: functionRag.needsTool, retrieved: functionRag.retrieved }).catch(() => undefined));
        }
    }
    if (repaired.length) {
        ctx.fns.procs.log.warn({
            event: "transcript.repair",
            msg: `${agent.id}: closed ${repaired.length} unanswered tool call(s)`,
            calls: repaired.map(r => `${r.name}#${r.id}`),
        });
    }

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

    // Durable attachment refs stay tiny in Postgres and are materialized only
    // for this provider request. This keeps forks, BM25 and compaction free of
    // base64 while retaining native image/PDF input where supported.
    const messages = await ctx.fns.attachments.resolveContent({ messages: [...bootstrap, ...base] });

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


function formatRagScore(value: any): string {
    const n = Number(value);
    if (!Number.isFinite(n)) return "—";
    return Math.abs(n) < 0.1 ? n.toFixed(5) : n.toFixed(3);
}
